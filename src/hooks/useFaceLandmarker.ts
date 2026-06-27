import { useEffect, useRef, useState, useCallback } from 'react';
import {
  BlendshapeMap,
  FaceLandmarkerResult,
  UseFaceLandmarkerOptions,
  UseFaceLandmarkerReturn,
} from '../types';

const NOD_HISTORY_LENGTH = 15;

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
// Module-level singleton for the MediaPipe import ONLY.
// The FaceLandmarker instance itself is NOT cached here — each hook instance
// owns its own landmarker and cleans it up on unmount.
//
// Separating the two prevents the bug where:
//   1. Component unmounts → landmarker.close() called
//   2. Component remounts → mediaPipePromise resolves instantly (cached)
//      but landmarkerRef.current is null until createFromOptions finishes
//   3. startDetection called before createFromOptions completes → silent no-op
// ---------------------------------------------------------------------------
let mediaPipeModulePromise: Promise<{ FaceLandmarker: any; FilesetResolver: any }> | null = null;

function loadMediaPipeModule(): Promise<{ FaceLandmarker: any; FilesetResolver: any }> {
  if (!mediaPipeModulePromise) {
    mediaPipeModulePromise = import('@mediapipe/tasks-vision').then((mod) => ({
      FaceLandmarker: mod.FaceLandmarker,
      FilesetResolver: mod.FilesetResolver,
    }));
  }
  return mediaPipeModulePromise;
}

// Derive the WASM path from the installed package version.
// Always uses the unversioned jsDelivr URL which redirects to latest —
// this matches whatever @mediapipe/tasks-vision version the consumer installed
// as long as they're on a recent version (>=0.10.0).
// The FilesetResolver caches WASM internally so repeated calls are free.
function getWasmPath(): string {
  return 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
}

export function useFaceLandmarker(
  videoRef: React.RefObject<HTMLVideoElement>,
  options: UseFaceLandmarkerOptions = {}
): UseFaceLandmarkerReturn {
  const { onResult } = options;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const landmarkerRef             = useRef<any>(null);
  const rafRef                    = useRef<number | null>(null);
  const runningRef                = useRef(false);
  const noseYHistoryRef           = useRef<number[]>([]);
  // Tracks whether init() is in progress so startDetection can wait for it
  const initPromiseRef            = useRef<Promise<void> | null>(null);

  // ---------------------------------------------------------------------------
  // Init runs ONCE on mount — not gated on any status/enabled prop.
  // The consumer controls detection via startDetection/stopDetection.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const initPromise = (async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { FaceLandmarker, FilesetResolver } = await loadMediaPipeModule();
        if (cancelled) return;

        const wasmPath = getWasmPath();
        console.info(`[react-liveness] WASM: ${wasmPath}`);

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

        if (cancelled) {
          faceLandmarker.close();
          return;
        }

        landmarkerRef.current = faceLandmarker;
        setIsLoading(false);
        console.info('[react-liveness] FaceLandmarker ready');
      } catch (err) {
        if (!cancelled) {
          console.error('[react-liveness] init failed:', err);
          setError(err instanceof Error ? err.message : 'Failed to load face detection model.');
          setIsLoading(false);
          // Reset module cache so a page refresh / retry can recover
          mediaPipeModulePromise = null;
        }
      }
    })();

    initPromiseRef.current = initPromise;

    return () => {
      cancelled = true;
      // Stop the RAF loop first, then close the landmarker
      runningRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  // Empty deps: run once on mount, clean up on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDetection = useCallback(() => {
    // If already running, no-op
    if (runningRef.current) return;

    // If landmarker isn't ready yet, wait for init then start
    if (!landmarkerRef.current) {
      initPromiseRef.current?.then(() => {
        if (landmarkerRef.current) {
          startDetection();
        }
      });
      return;
    }

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

          if (noseTip && leftCheek && rightCheek) {
            blendshapes['headYaw'] = noseTip.x - (leftCheek.x + rightCheek.x) / 2;
          }

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

  return { isLoading, error, startDetection, stopDetection };
}