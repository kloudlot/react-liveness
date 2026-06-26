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

export interface BlendshapeCondition {
  /** MediaPipe blendshape categoryName, or a synthetic key (headYaw, headNod) */
  key: string;
  /**
   * Pass condition:
   *   positive → score must exceed threshold
   *   negative → score must be below threshold (used for headYaw TURN_RIGHT)
   */
  threshold: number;
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

export type ChallengeStatus =
  | 'idle'       // not started
  | 'waiting'    // camera starting / model loading
  | 'detecting'  // active challenge in progress
  | 'complete'   // all challenges passed
  | 'failed';    // one or more challenges timed out

// ---------------------------------------------------------------------------
// Captured frame
// ---------------------------------------------------------------------------

export interface CapturedFrame {
  /** Base64 data URL — use for display or sending to backend */
  dataUrl: string;
  /** Lazy blob factory — use for FormData / multipart upload */
  blob: () => Promise<Blob>;
  width: number;
  height: number;
  capturedAt: Date;
}

export interface CaptureFrameOptions {
  scale?: number;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
}

// ---------------------------------------------------------------------------
// Hook result types
// ---------------------------------------------------------------------------

export interface BlendshapeMap {
  [key: string]: number;
}

export interface FaceLandmarkerResult {
  blendshapes: BlendshapeMap;
  faceDetected: boolean;
  landmarks: { x: number; y: number; z: number }[];
}

export interface UseFaceLandmarkerOptions {
  onResult?: (result: FaceLandmarkerResult) => void;
  enabled?: boolean;
}

export interface UseFaceLandmarkerReturn {
  isLoading: boolean;
  error: string | null;
  startDetection: () => void;
  stopDetection: () => void;
}

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
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

// ---------------------------------------------------------------------------
// Component prop types
// ---------------------------------------------------------------------------

export interface LivenessCheckProps {
  /**
   * Called when the session ends (pass or fail).
   * @param passed   true if all challenges completed in time
   * @param results  per-challenge breakdown
   * @param frame    captured photo at moment of completion (only when passed)
   */
  onComplete?: (passed: boolean, results: ChallengeResult[], frame?: CapturedFrame) => void;

  /**
   * Override the default challenge set.
   * If omitted, 3 challenges are randomly picked from the built-in set.
   */
  challenges?: Challenge[];

  /**
   * Number of challenges to pick when using the default set.
   * @default 3
   */
  challengeCount?: number;

  /**
   * Disable voice instructions and audio feedback.
   * @default false
   */
  muted?: boolean;

  /**
   * Additional CSS class applied to the root container.
   */
  className?: string;
}