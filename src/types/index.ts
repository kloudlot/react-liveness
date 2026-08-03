// ---------------------------------------------------------------------------
// Challenge types
// ---------------------------------------------------------------------------

export type ChallengeType =
  | 'BLINK'
  | 'SMILE'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'OPEN_MOUTH'
  | 'NOD'
  | string; // allow custom challenge types

/**
 * How a condition's score is compared against its threshold.
 *
 *   `above`    — score > threshold
 *   `below`    — score < threshold
 *   `absBelow` — |score| < threshold  (inside a band, e.g. "facing forward")
 *   `absAbove` — |score| > threshold  (outside a band, e.g. "turned either way")
 */
export type BlendshapeComparison = 'above' | 'below' | 'absBelow' | 'absAbove';

export interface BlendshapeCondition {
  /** MediaPipe blendshape categoryName, or a synthetic key (headYaw, headYawDeg, headNod) */
  key: string;
  threshold: number;
  /**
   * Defaults to the original rule, which infers direction from the threshold's
   * sign: positive → `above`, negative → `below`.
   *
   * That inference cannot express a band — "within ±12°" would require
   * `score < -12 && score > 12` — so band conditions must set this explicitly.
   */
  compare?: BlendshapeComparison;
}

export interface Challenge {
  type: ChallengeType;
  label: string;
  instruction: string;
  icon: string;
  timeoutMs: number;
  blendshapes: BlendshapeCondition[];
}

export interface ChallengeResult {
  type: ChallengeType;
  passed: boolean;
  timeMs: number;
}

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

/**
 * The full session machine.
 *
 *   idle → waiting → aligning → detecting → capturing → verifying → complete
 *                                   │           │            ├→ rejected
 *                                   ▼           ▼            └→ error
 *                                 failed ←──────┘
 *
 * Three terminal states rather than two, because they mean different things and
 * imply different next actions: `failed` is a liveness failure that never
 * reached a backend, `rejected` is a backend that answered no, and `error` is a
 * backend that could not be asked.
 */
export type ChallengeStatus =
  | 'idle'       // not started
  | 'waiting'    // camera starting / model loading
  | 'aligning'   // pre-challenge framing; establishes the pitch baseline
  | 'detecting'  // active challenge in progress
  | 'capturing'  // post-challenge frontal capture gate
  | 'verifying'  // backend verdict in flight
  | 'complete'   // liveness passed AND verified (or no backend configured)
  | 'failed'     // liveness itself failed — never submitted
  | 'rejected'   // backend answered no
  | 'error';     // backend could not be reached

/** Clearer alias; `ChallengeStatus` is kept for backwards compatibility. */
export type LivenessStatus = ChallengeStatus;

// ---------------------------------------------------------------------------
// Captured frame
// ---------------------------------------------------------------------------

// Defined in utils/captureFrame.ts and re-exported here. Previously declared in
// both places, which surfaced in the bundled .d.ts as `CapturedFrame$1` — two
// structurally identical types that TypeScript treated as distinct.
export type {
  CapturedFrame,
  CaptureFrameOptions,
  CaptureQuality,
  GateId,
  GateFailure,
} from '../utils/captureFrame';

// ---------------------------------------------------------------------------
// Hook result types
// ---------------------------------------------------------------------------

export interface BlendshapeMap {
  [key: string]: number;
}

import type { HeadPose, FaceGeometry } from '../utils/facePose';

export type { Landmark, HeadPose, FaceBox, FaceGeometry } from '../utils/facePose';
export type { FrameQuality, MeasureOptions } from '../utils/frameQuality';

export interface FaceLandmarkerResult {
  blendshapes: BlendshapeMap;
  faceDetected: boolean;
  /** Landmarks for the primary (largest) face. Empty when no face is present. */
  landmarks: import('../utils/facePose').Landmark[];
  /**
   * Number of faces detected, capped by the `numFaces` option. Values > 1 mean
   * someone other than the subject is in frame — a rejection signal for capture.
   */
  faceCount: number;
  /** Head orientation of the primary face, or null when no face is detected. */
  pose: HeadPose | null;
  /** Framing and size of the primary face, or null when no face is detected. */
  geometry: FaceGeometry | null;
}

export interface UseFaceLandmarkerOptions {
  onResult?: (result: FaceLandmarkerResult) => void;
  enabled?: boolean;
  /**
   * Maximum faces to detect. Kept at 2 so a second person in frame can be
   * *detected* rather than silently ignored; the primary (largest) face still
   * drives all logic. Drop to 1 to reclaim inference time on low-end devices
   * running the CPU delegate.
   * @default 2
   */
  numFaces?: number;
  /**
   * Base URL the MediaPipe WASM binaries are loaded from. Override to self-host
   * — required for CSP-restricted, air-gapped or offline deployments. Copy
   * `node_modules/@mediapipe/tasks-vision/wasm` into your static assets and
   * point this at it.
   * @default a jsDelivr URL pinned to MEDIAPIPE_WASM_VERSION
   */
  wasmBasePath?: string;
  /** Override the face landmarker model asset URL (self-hosting). */
  modelAssetPath?: string;
}

export interface UseFaceLandmarkerReturn {
  isLoading: boolean;
  error: string | null;
  startDetection: () => void;
  stopDetection: () => void;
  /** Resolves when the FaceLandmarker model is initialized and ready to detect. */
  waitForReady: () => Promise<void>;
}

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraReady: boolean;
  error: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

export interface UseLivenessAudioReturn {
  announceChallenge: (instruction: string) => void;
  announcePass: () => void;
  announceTimeout: () => void;
  announceComplete: () => void;
  announceFail: () => void;
  stop: () => void;
}

