// utils/mediapipeConfig.ts
//
// MediaPipe loading configuration, deliberately free of React so that dev
// tooling (the calibration harness) can share the exact detection setup used in
// production. Thresholds calibrated against a different config are worthless.

// ---------------------------------------------------------------------------
// WASM version pinning
//
// The JS glue and the WASM binary are a matched pair — loading mismatched
// versions fails in obscure ways. This was previously pinned to 0.10.14 while
// the peer dependency floor was >= 0.10.35, so every consumer ran a skewed pair.
//
// There is no portable way to derive the URL of a bundled asset from library
// code (approaches differ per bundler, and @mediapipe/tasks-vision exports no
// runtime version constant), so the default stays a pinned CDN URL tracking the
// peer floor. Consumers needing determinism, CSP compliance or offline support
// should self-host and pass `wasmBasePath`.
//
// KEEP IN SYNC with the @mediapipe/tasks-vision peerDependency in package.json.
// ---------------------------------------------------------------------------
export const MEDIAPIPE_WASM_VERSION = '0.10.35';

export const DEFAULT_WASM_BASE_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_WASM_VERSION}/wasm`;

export const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Default maximum faces to detect. See UseFaceLandmarkerOptions.numFaces. */
export const DEFAULT_NUM_FACES = 2;

// ---------------------------------------------------------------------------
// GPU support detection
// MediaPipe's GPU delegate requires WebGL2 + EXT_color_buffer_float. Mid-range
// Android devices (e.g. Nokia X20) have WebGL2 but lack the extension, causing
// silent init failures. Fall back to CPU.
// ---------------------------------------------------------------------------
export function supportsGpuDelegate(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    return !!gl.getExtension('EXT_color_buffer_float');
  } catch {
    return false;
  }
}

/**
 * Options passed to FaceLandmarker.createFromOptions. Shared so the calibration
 * harness measures the same model configuration that ships.
 */
export function faceLandmarkerOptions(opts: {
  modelAssetPath?: string;
  numFaces?: number;
} = {}) {
  return {
    baseOptions: {
      modelAssetPath: opts.modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH,
      delegate: supportsGpuDelegate() ? ('GPU' as const) : ('CPU' as const),
    },
    outputFaceBlendshapes: true,
    // Head orientation is not encoded in any blendshape, so the frontal capture
    // gate depends on this matrix.
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO' as const,
    numFaces: opts.numFaces ?? DEFAULT_NUM_FACES,
  };
}
