'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface BlendshapeMap {
  [key: string]: number;
}

export interface FaceLandmarkerResult {
  blendshapes: BlendshapeMap;
  faceDetected: boolean;
  landmarks: { x: number; y: number; z: number }[];
}

interface UseFaceLandmarkerOptions {
  onResult?: (result: FaceLandmarkerResult) => void;
  enabled?: boolean;
}

// Sliding-window constants for headNod synthesis
const NOD_HISTORY_LENGTH = 15;

// ---------------------------------------------------------------------------
// GPU support detection
// MediaPipe GPU delegate requires WebGL2 + EXT_color_buffer_float.
// Mid-range Android devices (e.g. Nokia X20) have WebGL2 but lack the
// required extension, causing silent init failures. Fall back to CPU.
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
// loadMediaPipe — dynamic ES module import, no <Script> tag needed.
//
// WHY NOT window globals / <Script> tags:
//   • next/script beforeInteractive only works in layout.tsx / _document.js,
//     not in page components. Even then it doesn't block hook execution.
//   • vision_bundle.mjs is ESM and never sets window globals.
//   • vision_bundle.js (UMD) sets globals but load timing is not guaranteed
//     relative to React hydration, especially on slow mobile connections.
//
// Dynamic import() is the correct pattern for Next.js App Router:
//   • Module is fetched exactly once (bundler/browser cache deduplicates).
//   • Promise resolves only after the module is fully executed.
//   • Works in both SSR (guarded by the enabled check) and CSR.
//   • No polling, no race conditions, no global namespace pollution.
// ---------------------------------------------------------------------------
let mediaPipePromise: Promise<{ FaceLandmarker: any; FilesetResolver: any }> | null = null;

function loadMediaPipe(): Promise<{ FaceLandmarker: any; FilesetResolver: any }> {
  // Singleton promise — only one network request regardless of how many
  // times the hook mounts (e.g. StrictMode double-mount, route transitions).
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
) {
  const { onResult, enabled = true } = options;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // Sliding window for headNod: tracks noseTip.y over the last N frames
  const noseYHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function init() {
      try {
        const { FaceLandmarker, FilesetResolver } = await loadMediaPipe();

        if (cancelled) return;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          // Pin to a specific version to avoid unexpected breaking changes on mobile.
          // The WASM files are small (~500KB) and cached after the first load.
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        if (cancelled) return;

        const useGpu = supportsGpuDelegate();
        console.info(`[useFaceLandmarker] Using ${useGpu ? 'GPU' : 'CPU'} delegate`);

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
      } catch (err) {
        if (!cancelled) {
          console.error('[useFaceLandmarker] init failed:', err);
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load face detection model. Please check your connection and try again.'
          );
          setIsLoading(false);
          // Reset the singleton so a retry (handleReset → re-enable) fetches fresh
          mediaPipePromise = null;
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const startDetection = useCallback(() => {
    if (!landmarkerRef.current || runningRef.current) return;
    runningRef.current = true;
    // Clear nod history on (re)start so stale frames don't pollute a new challenge
    noseYHistoryRef.current = [];

    function detect() {
      if (!runningRef.current || !videoRef.current || !landmarkerRef.current) return;

      const video = videoRef.current;
      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      try {
        const results = landmarkerRef.current.detectForVideo(video, performance.now());
        const faceDetected = (results.faceLandmarks?.length ?? 0) > 0;
        const rawBlendshapes = results.faceBlendshapes?.[0]?.categories ?? [];

        const blendshapes: BlendshapeMap = {};
        for (const b of rawBlendshapes) {
          blendshapes[b.categoryName] = b.score;
        }

        if (faceDetected && results.faceLandmarks?.[0]) {
          const landmarks = results.faceLandmarks[0];

          // ── headYaw ──────────────────────────────────────────────────────────
          // Computed in MediaPipe's unmirrored coordinate space.
          // noseTip (1) vs midpoint of left cheek (234) and right cheek (454).
          //
          // Because the video renders with scaleX(-1):
          //   User turns LEFT  on screen → noseTip.x > centerX → headYaw > 0
          //   User turns RIGHT on screen → noseTip.x < centerX → headYaw < 0
          //
          // Positive threshold → passes when headYaw > threshold (turn left)
          // Negative threshold → passes when headYaw < threshold (turn right)
          const noseTip    = landmarks[1];
          const leftCheek  = landmarks[234];
          const rightCheek = landmarks[454];
          if (noseTip && leftCheek && rightCheek) {
            const centerX = (leftCheek.x + rightCheek.x) / 2;
            blendshapes['headYaw'] = noseTip.x - centerX;
          }

          // ── headNod ──────────────────────────────────────────────────────────
          // No blendshape encodes head pitch, so we synthesise one via a
          // sliding window on noseTip.y across NOD_HISTORY_LENGTH frames.
          // A natural nod moves the nose ~0.015–0.025 in normalised coords.
          const noseY = landmarks[1]?.y;
          if (noseY !== undefined) {
            noseYHistoryRef.current.push(noseY);
            if (noseYHistoryRef.current.length > NOD_HISTORY_LENGTH) {
              noseYHistoryRef.current.shift();
            }
            if (noseYHistoryRef.current.length === NOD_HISTORY_LENGTH) {
              const ys = noseYHistoryRef.current;
              const range = Math.max(...ys) - Math.min(...ys);
              blendshapes['headNod'] = range;
            }
          }
        }

        onResult?.({
          blendshapes,
          faceDetected,
          landmarks: results.faceLandmarks?.[0] ?? [],
        });
      } catch {
        // Silently skip frame errors to avoid interrupting the RAF loop
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