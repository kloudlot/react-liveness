import { useEffect, useRef, useState, useCallback } from 'react';
import {
  BlendshapeMap,
  FaceLandmarkerResult,
  UseFaceLandmarkerOptions,
  UseFaceLandmarkerReturn,
} from '../types';

const NOD_HISTORY_LENGTH = 15;

// ---------------------------------------------------------------------------
// GPU support detection
// Requires WebGL2 + EXT_color_buffer_float. Mid-range Android devices often
// have WebGL2 but lack the extension — fall back to CPU silently.
// ---------------------------------------------------------------------------
function supportsGpuDelegate(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    return !!gl.getExtension('EXT_color_buffer_float');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve WASM base path from the installed @mediapipe/tasks-vision package.
//
// WHY NOT a hardcoded CDN URL:
//   The CDN URL must match the exact installed JS version or the WASM binary
//   is incompatible and detectForVideo silently returns no landmarks.
//   e.g. JS=0.10.35 + WASM@0.10.14 = detector initialises but returns [].
//
// HOW THIS WORKS:
//   @mediapipe/tasks-vision exports its WASM files via package.json "exports".
//   We import one of them and derive the base directory from its resolved URL.
//   This always matches the installed version — no hardcoding needed.
// ---------------------------------------------------------------------------
async function resolveWasmPath(): Promise<string> {
  try {
    // Import the internal WASM loader — its resolved URL tells us where
    // the package's wasm/ directory lives in the consumer's bundler output.
    const wasmModule = await import(
      /* webpackChunkName: "mediapipe-wasm" */
      // @ts-ignore
      '@mediapipe/tasks-vision/vision_wasm_internal.js'
    );
    // The module's default export or import.meta.url gives us the resolved path.
    // Strip the filename to get the directory.
    const url: string =
      (wasmModule as any).default?.locateFile?.('') ??
      (typeof (wasmModule as any).__esModule !== 'undefined'
        ? new URL('./wasm', import.meta.url).href
        : '');
    if (url) return url.replace(/\/[^/]+$/, '');
  } catch {
    // Bundler didn't resolve the internal module path — fall through to CDN
  }

  // Fallback: derive version from the JS module itself and hit jsDelivr.
  // This still matches versions because we read it dynamically.
  try {
    const pkg = await fetch(
      new URL('../../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url)
    ).then((r) => r.json()).catch(() => null);
    if (pkg?.version) {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${pkg.version}/wasm`;
    }
  } catch {
    // ignore
  }

  // Last resort: use a version-agnostic jsDelivr URL (no @version = latest)
  return 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
}

// ---------------------------------------------------------------------------
// Singleton dynamic import — one network request, shared across all instances
// ---------------------------------------------------------------------------
let mediaPipePromise: Promise<{ FaceLandmarker: any; FilesetResolver: any }> | null = null;

function loadMediaPipe(): Promise<{ FaceLandmarker: any; FilesetResolver: any }> {
  if (!mediaPipePromise) {
    mediaPipePromise = import('@mediapipe/tasks-vision').then((mod) => ({
      FaceLandmarker: mod.FaceLandmarker,
      FilesetResolver: mod.FilesetResolver,
    }));
  }
  return mediaPipePromise;
}

export function useFaceLandmarker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseFaceLandmarkerOptions = {}
): UseFaceLandmarkerReturn {
  const { onResult, enabled = true } = options;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const landmarkerRef             = useRef<any>(null);
  const rafRef                    = useRef<number | null>(null);
  const runningRef                = useRef(false);
  const noseYHistoryRef           = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function init() {
      try {
        const [{ FaceLandmarker, FilesetResolver }, wasmPath] = await Promise.all([
          loadMediaPipe(),
          resolveWasmPath(),
        ]);

        if (cancelled) return;

        console.info(`[react-liveness] WASM path: ${wasmPath}`);

        const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
        if (cancelled) return;

        const useGpu = supportsGpuDelegate();
        console.info(`[react-liveness] Delegate: ${useGpu ? 'GPU' : 'CPU'}`);

        const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: useGpu ? 'GPU' : 'CPU',
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });

        if (cancelled) { faceLandmarker.close(); return; }

        landmarkerRef.current = faceLandmarker;
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[react-liveness] init failed:', err);
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load face detection model.'
          );
          setIsLoading(false);
          mediaPipePromise = null; // allow retry
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, [enabled]);

  const startDetection = useCallback(() => {
    if (!landmarkerRef.current || runningRef.current) return;
    runningRef.current = true;
    noseYHistoryRef.current = [];

    function detect() {
      if (!runningRef.current || !videoRef.current || !landmarkerRef.current) return;

      const video = videoRef.current;
      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      try {
        const results      = landmarkerRef.current.detectForVideo(video, performance.now());
        const faceDetected = (results.faceLandmarks?.length ?? 0) > 0;
        const blendshapes: BlendshapeMap = {};

        for (const b of results.faceBlendshapes?.[0]?.categories ?? []) {
          blendshapes[b.categoryName] = b.score;
        }

        if (faceDetected && results.faceLandmarks?.[0]) {
          const lm         = results.faceLandmarks[0];
          const noseTip    = lm[1];
          const leftCheek  = lm[234];
          const rightCheek = lm[454];

          // Synthetic headYaw — unmirrored landmark space
          // video renders scaleX(-1) so: left on screen = positive yaw
          if (noseTip && leftCheek && rightCheek) {
            blendshapes['headYaw'] = noseTip.x - (leftCheek.x + rightCheek.x) / 2;
          }

          // Synthetic headNod — sliding window on noseTip.y
          const noseY = noseTip?.y;
          if (noseY !== undefined) {
            noseYHistoryRef.current.push(noseY);
            if (noseYHistoryRef.current.length > NOD_HISTORY_LENGTH) {
              noseYHistoryRef.current.shift();
            }
            if (noseYHistoryRef.current.length === NOD_HISTORY_LENGTH) {
              const ys = noseYHistoryRef.current;
              blendshapes['headNod'] = Math.max(...ys) - Math.min(...ys);
            }
          }
        }

        onResult?.({ blendshapes, faceDetected, landmarks: results.faceLandmarks?.[0] ?? [] });
      } catch {
        // skip frame errors silently
      }

      rafRef.current = requestAnimationFrame(detect);
    }

    rafRef.current = requestAnimationFrame(detect);
  }, [videoRef, onResult]);

  const stopDetection = useCallback(() => {
    runningRef.current = false;
    noseYHistoryRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopDetection();
      landmarkerRef.current?.close();
    };
  }, [stopDetection]);

  return { isLoading, error, startDetection, stopDetection };
}