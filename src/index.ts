// Component
export { LivenessCheck } from './components/LivenessCheck';

// Hooks — for headless / custom UI usage
export { useFaceLandmarker } from './hooks/useFaceLandmarker';
export { useLivenessAudio }  from './hooks/useLivenessAudio';
export { useCamera }         from './hooks/useCamera';

// Challenge helpers
export { DEFAULT_CHALLENGES, pickChallenges } from './challenges';

// Utilities
export { captureFrame } from './utils/captureFrame';

// Types
export type {
  // Challenge
  Challenge,
  ChallengeType,
  ChallengeResult,
  ChallengeStatus,
  BlendshapeCondition,
  // Frame
  CapturedFrame,
  CaptureFrameOptions,
  // Hook options / returns
  BlendshapeMap,
  FaceLandmarkerResult,
  UseFaceLandmarkerOptions,
  UseFaceLandmarkerReturn,
  UseLivenessAudioReturn,
  UseCameraReturn,
  // Component props
  LivenessCheckProps,
} from './types';