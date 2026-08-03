// Component
export { LivenessCheck } from './components/LivenessCheck';
export type { LivenessCheckProps, LivenessTheme, LivenessStyles } from './components/LivenessCheck';

// Optional landmark overlay, for the headless path
export { FaceOverlay } from './components/FaceOverlay';

// Hooks — for headless / custom UI usage
export { useFaceLandmarker, MEDIAPIPE_WASM_VERSION } from './hooks/useFaceLandmarker';
export { useLivenessAudio }  from './hooks/useLivenessAudio';
export { useCamera }         from './hooks/useCamera';
export { useCenteredCapture } from './hooks/useCenteredCapture';
export { useVerification } from './hooks/useVerification';
export type {
  VerificationVerdict,
  VerificationPayload,
  VerificationState,
  VerifyContext,
  RejectionReason,
  RetryScope,
  UseVerificationOptions,
  UseVerificationReturn,
} from './hooks/useVerification';
export type {
  CaptureState,
  UseCenteredCaptureOptions,
  UseCenteredCaptureReturn,
} from './hooks/useCenteredCapture';

// Challenge helpers
export { DEFAULT_CHALLENGES, CENTER_FACE_CHALLENGE, pickChallenges } from './challenges';

// Utilities
export { captureFrame, drawVideoFrame, frameFromCanvas } from './utils/captureFrame';
export { evaluateGates, scoreFrame, poseJitter } from './utils/evaluateGates';
export type { GateInput } from './utils/evaluateGates';
export {
  derivePose,
  deriveGeometry,
  poseFromMatrix,
  poseFromLandmarks,
  pickPrimaryFace,
} from './utils/facePose';
export { measureFrameQuality, releaseQualityCanvas } from './utils/frameQuality';
export { DEFAULT_CAPTURE_GATES } from './utils/captureGates';
export type { CaptureGates } from './utils/captureGates';

// Types
export type {
  // Challenge
  Challenge,
  ChallengeType,
  ChallengeResult,
  ChallengeStatus,
  LivenessStatus,
  BlendshapeCondition,
  BlendshapeComparison,
  // Frame / capture
  CapturedFrame,
  CaptureFrameOptions,
  CaptureQuality,
  GateId,
  GateFailure,
  // Face pose / geometry / quality
  Landmark,
  HeadPose,
  FaceBox,
  FaceGeometry,
  FrameQuality,
  MeasureOptions,
  // Hook options / returns
  BlendshapeMap,
  FaceLandmarkerResult,
  UseFaceLandmarkerOptions,
  UseFaceLandmarkerReturn,
  UseLivenessAudioReturn,
  UseCameraReturn,
} from './types';