// utils/evaluateGates.ts
//
// Pure gate evaluation — no DOM, no React, no camera. Kept separate from the
// capture hook so the accept/reject policy can be tested against fixture
// metrics rather than against a live webcam.

import type { CaptureGates } from './captureGates';
import type { FrameQuality } from './frameQuality';
import type { HeadPose, FaceGeometry } from './facePose';
import type { CaptureQuality, GateFailure } from './captureFrame';

export interface GateInput {
  faceCount: number;
  pose: HeadPose | null;
  geometry: FaceGeometry | null;
  image: FrameQuality | null;
  eyeBlink: number;
  jawOpen: number;
  smile: number;
  /** Peak-to-peak pose spread over the stability window, degrees. */
  poseJitterDeg: number;
  /**
   * Session pitch baseline in degrees, subtracted before the pitch gate.
   * Camera height contributes a large constant offset to pitch (a laptop
   * measured +3.9° on a level head; a phone held low reads far higher), so an
   * absolute pitch limit does not transfer between devices. The align phase
   * supplies this; 0 falls back to an absolute check.
   */
  pitchBaselineDeg?: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Evaluate every gate against one frame's metrics.
 *
 * Gates are evaluated in priority order, so `failures[0]` is the most useful
 * thing to tell the user. Ordering is not cosmetic:
 *
 *   • Size runs before sharpness. Sharpness is measured on a fixed-size window,
 *     so a small face admits background — which is static and textured, and
 *     therefore measures SHARPER than a correctly-framed face (87.9 vs 57.2 on
 *     the calibration device). Sharpness is only meaningful once size passes.
 *
 *   • Stability runs before sharpness for the same reason in reverse: measured
 *     sharpness distributions for held and moving faces overlap across most of
 *     their range, so motion must be caught by pose jitter instead.
 */
export function evaluateGates(input: GateInput, gates: CaptureGates): CaptureQuality {
  const failures: GateFailure[] = [];
  const fail = (gate: GateFailure['gate'], message: string, value: number, limit: number) =>
    failures.push({ gate, message, value, limit });

  const { pose, geometry, image } = input;

  // -- Presence ------------------------------------------------------------
  if (input.faceCount === 0 || !geometry) {
    fail('no_face', 'Move into the frame', 0, 1);
  } else if (input.faceCount > 1) {
    fail('multiple_faces', 'Only one person in frame', input.faceCount, 1);
  }

  // -- Framing (must precede sharpness) ------------------------------------
  if (geometry) {
    if (geometry.eyeSpan < gates.minEyeSpan) {
      fail('too_far', 'Move closer', geometry.eyeSpan, gates.minEyeSpan);
    }
    if (geometry.centerOffset > gates.maxCenterOffset) {
      fail('off_center', 'Centre your face', geometry.centerOffset, gates.maxCenterOffset);
    }
  }

  // -- Orientation ---------------------------------------------------------
  if (pose) {
    const yaw = Math.abs(pose.yawDeg);
    const pitch = Math.abs(pose.pitchDeg - (input.pitchBaselineDeg ?? 0));
    const roll = Math.abs(pose.rollDeg);

    if (yaw > gates.maxYawDeg) fail('yaw', 'Face the camera', yaw, gates.maxYawDeg);
    if (pitch > gates.maxPitchDeg) fail('pitch', 'Look straight ahead', pitch, gates.maxPitchDeg);
    if (roll > gates.maxRollDeg) fail('roll', 'Straighten your head', roll, gates.maxRollDeg);
  }

  // -- Stability (the real motion gate) ------------------------------------
  if (input.poseJitterDeg > gates.maxPoseJitterDeg) {
    fail('unstable', 'Hold still', input.poseJitterDeg, gates.maxPoseJitterDeg);
  }

  // -- Subject state -------------------------------------------------------
  if (input.eyeBlink > gates.maxEyeBlink) {
    fail('eyes_closed', 'Open your eyes', input.eyeBlink, gates.maxEyeBlink);
  }
  if (input.jawOpen > gates.maxJawOpen) {
    fail('expression', 'Relax your expression', input.jawOpen, gates.maxJawOpen);
  } else if (input.smile > gates.maxSmile) {
    fail('expression', 'Relax your expression', input.smile, gates.maxSmile);
  }

  // -- Exposure ------------------------------------------------------------
  if (image) {
    if (image.underexposed > gates.maxUnderexposed) {
      fail('too_dark', 'Find better lighting', image.underexposed, gates.maxUnderexposed);
    } else if (image.brightness < gates.minBrightness) {
      fail('too_dark', 'Find better lighting', image.brightness, gates.minBrightness);
    }

    // -- Focus (last: only meaningful once size and stability pass) --------
    if (image.sharpness < gates.minSharpness) {
      fail('blurred', 'Hold still and steady the camera', image.sharpness, gates.minSharpness);
    }
  }

  return {
    pose,
    geometry,
    image,
    faceCount: input.faceCount,
    eyeBlink: input.eyeBlink,
    jawOpen: input.jawOpen,
    smile: input.smile,
    poseJitterDeg: input.poseJitterDeg,
    score: scoreFrame(input, gates),
    passedGates: failures.length === 0,
    failures,
  };
}

/**
 * Composite desirability, 0–1. Only used to rank frames that already passed
 * every gate, so it expresses preference, not acceptability — a frame scoring
 * 0.3 here is still a valid capture, just a worse one than a frame scoring 0.8.
 */
export function scoreFrame(input: GateInput, gates: CaptureGates): number {
  const { pose, geometry, image } = input;
  if (!geometry) return 0;

  const poseScore = pose
    ? 1 -
      clamp01(
        (Math.abs(pose.yawDeg) / gates.maxYawDeg +
          Math.abs(pose.pitchDeg - (input.pitchBaselineDeg ?? 0)) / gates.maxPitchDeg +
          Math.abs(pose.rollDeg) / gates.maxRollDeg) /
          3,
      )
    : 0;

  // Bigger is better up to ~2× the minimum, then it stops mattering.
  const sizeScore = clamp01((geometry.eyeSpan - gates.minEyeSpan) / gates.minEyeSpan);
  const centerScore = 1 - clamp01(geometry.centerOffset / gates.maxCenterOffset);
  const sharpScore = image ? clamp01(image.sharpnessScore) : 0;
  const exposureScore = image
    ? clamp01(1 - image.underexposed / gates.maxUnderexposed) * clamp01(1 - image.overexposed * 4)
    : 0;
  const eyesScore = 1 - clamp01(input.eyeBlink / gates.maxEyeBlink);

  return clamp01(
    0.3 * poseScore +
      0.15 * sizeScore +
      0.15 * centerScore +
      0.15 * sharpScore +
      0.15 * exposureScore +
      0.1 * eyesScore,
  );
}

/** Peak-to-peak spread of yaw and pitch across a pose history window. */
export function poseJitter(history: HeadPose[]): number {
  if (history.length < 2) return 0;

  let minYaw = Infinity, maxYaw = -Infinity;
  let minPitch = Infinity, maxPitch = -Infinity;

  for (const p of history) {
    if (p.yawDeg < minYaw) minYaw = p.yawDeg;
    if (p.yawDeg > maxYaw) maxYaw = p.yawDeg;
    if (p.pitchDeg < minPitch) minPitch = p.pitchDeg;
    if (p.pitchDeg > maxPitch) maxPitch = p.pitchDeg;
  }

  return Math.max(maxYaw - minYaw, maxPitch - minPitch);
}
