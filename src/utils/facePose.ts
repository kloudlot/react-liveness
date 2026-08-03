// utils/facePose.ts
//
// Head-pose and face-geometry derivation.
//
// MediaPipe's blendshapes describe *expression* only — none of the 52 ARKit
// shapes encode head orientation. To gate on "is the user facing the camera"
// we derive pose ourselves, preferring the facial transformation matrix and
// falling back to landmark geometry when it is unavailable.

/** A single normalised face-mesh point in unmirrored source-frame coordinates. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Landmark indices (MediaPipe canonical face mesh)
// ---------------------------------------------------------------------------

const NOSE_TIP = 1;
const CHIN = 152;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Sign calibration
//
// MediaPipe's transformation matrix lives in unmirrored camera space, while the
// preview renders with scaleX(-1). That mismatch has already caused one bug in
// this codebase (see the headYaw derivation in useFaceLandmarker). Rather than
// rewriting the decomposition when a sign turns out to be inverted on a real
// device, flip it here.
//
// Convention — angles are SCREEN-relative, matching the existing `headYaw` key:
//   yawDeg   > 0  → user turned toward the left of the mirrored preview
//   pitchDeg > 0  → user tilted their chin up
//   rollDeg  > 0  → user tilted their head toward their right shoulder
//
// TODO(calibration): verify all three against a real device before locking the
// frontal-gate thresholds. Only |magnitude| matters for the frontal gate, so
// these signs are low-risk there but must be correct for pose-based challenges.
// ---------------------------------------------------------------------------

// Calibrated 2026-08-03 (MacBook built-in camera, matrix source):
//   pitch — chin-up read negative, so it is inverted here.
//   yaw / roll — observed already matching the convention above.
// yaw remains the least-verified of the three: the calibration run that set
// these produced no usable head-turn sample, so its sign rests on the sign
// capture alone rather than on a corroborating scenario.
const SIGN = { yaw: 1, pitch: -1, roll: 1 } as const;

// Frontal reference for the landmark-fallback pitch estimate: on a face looking
// straight ahead the nose tip sits roughly this far down the eye-line→chin span.
const NOMINAL_NOSE_RATIO = 0.42;
// Maps nose-ratio deviation onto degrees. Approximate by construction.
const PITCH_RATIO_TO_DEG = 110;

export interface HeadPose {
  /** Degrees. See the SIGN block above for orientation conventions. */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /**
   * How the pose was derived. `landmarks` is a geometric approximation that is
   * monotonic and good enough for gating, but is not metrically accurate —
   * do not surface its values to users as real angles.
   */
  source: 'matrix' | 'landmarks';
}

export interface FaceBox {
  /** All values normalised 0–1 against the source frame, unmirrored. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceGeometry {
  box: FaceBox;
  /** Euclidean distance from face-box centre to frame centre, normalised. */
  centerOffset: number;
  /**
   * Outer-eye-corner span as a fraction of frame width. Preferred over box
   * width as a size proxy because it barely changes as the head turns.
   */
  eyeSpan: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// poseFromMatrix — decompose MediaPipe's 4×4 facial transformation matrix.
//
// `data` is a flattened COLUMN-MAJOR 4×4, so element (row r, col c) is at
// data[c * 4 + r].
//
// Extraction assumes R = Rz(roll) · Ry(yaw) · Rx(pitch), giving:
//   r20 = -sin(yaw)
//   r21 =  cos(yaw)·sin(pitch)      r22 = cos(yaw)·cos(pitch)
//   r00 =  cos(roll)·cos(yaw)       r10 = sin(roll)·cos(yaw)
// ---------------------------------------------------------------------------
export function poseFromMatrix(data: number[] | undefined | null): HeadPose | null {
  if (!data || data.length < 16) return null;

  const r00 = data[0], r10 = data[1], r20 = data[2];
  const r11 = data[5], r21 = data[6];
  const r12 = data[9], r22 = data[10];

  if (!Number.isFinite(r00) || !Number.isFinite(r20)) return null;

  let yaw: number;
  let pitch: number;
  let roll: number;

  // Gimbal lock: yaw at ±90° collapses pitch and roll onto the same axis, so
  // roll becomes arbitrary. Pin it to 0 and fold the rotation into pitch.
  if (Math.abs(r20) > 0.9999) {
    yaw = Math.sign(-r20) * (Math.PI / 2);
    pitch = Math.atan2(-r12, r11);
    roll = 0;
  } else {
    yaw = Math.asin(clamp(-r20, -1, 1));
    pitch = Math.atan2(r21, r22);
    roll = Math.atan2(r10, r00);
  }

  return {
    yawDeg: SIGN.yaw * yaw * RAD2DEG,
    pitchDeg: SIGN.pitch * pitch * RAD2DEG,
    rollDeg: SIGN.roll * roll * RAD2DEG,
    source: 'matrix',
  };
}

// ---------------------------------------------------------------------------
// poseFromLandmarks — geometric fallback.
//
// Used when the transformation matrix is unavailable (older WASM builds, or a
// consumer who disabled it). Roll is genuinely accurate here; yaw and pitch are
// monotonic approximations calibrated to be usable as gate thresholds only.
// ---------------------------------------------------------------------------
export function poseFromLandmarks(landmarks: Landmark[]): HeadPose | null {
  const nose = landmarks[NOSE_TIP];
  const chin = landmarks[CHIN];
  const leftCheek = landmarks[LEFT_CHEEK];
  const rightCheek = landmarks[RIGHT_CHEEK];
  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];

  if (!nose || !chin || !leftCheek || !rightCheek || !leftEye || !rightEye) {
    return null;
  }

  // Yaw — nose offset from the cheek midpoint, normalised by half the cheek
  // span so it is invariant to how close the user is to the camera.
  const centerX = (leftCheek.x + rightCheek.x) / 2;
  const halfSpan = Math.abs(rightCheek.x - leftCheek.x) / 2;
  const yawDeg =
    halfSpan > 1e-6
      ? Math.asin(clamp((nose.x - centerX) / halfSpan, -1, 1)) * RAD2DEG
      : 0;

  // Pitch — where the nose sits along the eye-line→chin span. Rises as the chin
  // lifts, falls as the head drops.
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const faceSpanY = chin.y - eyeMidY;
  const noseRatio = Math.abs(faceSpanY) > 1e-6 ? (nose.y - eyeMidY) / faceSpanY : NOMINAL_NOSE_RATIO;
  const pitchDeg = (NOMINAL_NOSE_RATIO - noseRatio) * PITCH_RATIO_TO_DEG;

  // Roll — the eye-line's tilt off horizontal. Exact.
  const rollDeg = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * RAD2DEG;

  return {
    yawDeg: SIGN.yaw * yawDeg,
    pitchDeg: SIGN.pitch * pitchDeg,
    rollDeg: SIGN.roll * rollDeg,
    source: 'landmarks',
  };
}

/** Prefer the matrix, fall back to landmark geometry. */
export function derivePose(
  matrixData: number[] | undefined | null,
  landmarks: Landmark[],
): HeadPose | null {
  return poseFromMatrix(matrixData) ?? poseFromLandmarks(landmarks);
}

// ---------------------------------------------------------------------------
// deriveGeometry — bounding box, framing and size, all in normalised source
// coordinates.
//
// NOTE: these are source-frame values. The preview renders with objectFit
// `cover` inside a circular mask, so a face centred here is not pixel-identical
// to a face centred in what the user sees. Source-frame framing is the correct
// basis for the captured image; treat centerOffset as "safely inside the
// frame", not as a precise on-screen alignment.
// ---------------------------------------------------------------------------
export function deriveGeometry(landmarks: Landmark[]): FaceGeometry | null {
  if (!landmarks.length) return null;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const box: FaceBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const centerOffset = Math.hypot(cx - 0.5, cy - 0.5);

  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const eyeSpan =
    leftEye && rightEye ? Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) : box.width;

  return { box, centerOffset, eyeSpan };
}

// ---------------------------------------------------------------------------
// pickPrimaryFace — index of the largest face by bounding-box area.
//
// With numFaces > 1, MediaPipe does not guarantee that index 0 is the subject.
// Blindly reading [0] lets a face in the background hijack detection, so always
// resolve the primary index first and use it for landmarks, blendshapes and
// matrices alike.
// ---------------------------------------------------------------------------
export function pickPrimaryFace(faces: Landmark[][]): number {
  if (faces.length <= 1) return 0;

  let bestIdx = 0;
  let bestArea = -1;

  for (let i = 0; i < faces.length; i++) {
    const geo = deriveGeometry(faces[i]);
    if (!geo) continue;
    const area = geo.box.width * geo.box.height;
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
  }

  return bestIdx;
}
