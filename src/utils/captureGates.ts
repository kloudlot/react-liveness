// utils/captureGates.ts
//
// Default acceptance thresholds for the frontal capture phase.
//
// Provenance: derived from a calibration run on 2026-08-03 (MacBook built-in
// camera, 640×480, GPU delegate) via `npm run calibrate`. Where a value departs
// from the raw derivation the reason is recorded inline — the harness brackets
// against one operator on one device, which is the right basis for a starting
// point and the wrong basis for a hard limit.
//
// Re-run the harness when changing camera constraints, the sampling geometry in
// frameQuality.ts, or the pose derivation in facePose.ts.

export interface CaptureGates {
  /** Max absolute head yaw, degrees. */
  maxYawDeg: number;
  /** Max absolute head pitch, degrees, relative to the session baseline. */
  maxPitchDeg: number;
  /** Max absolute head roll, degrees. */
  maxRollDeg: number;
  /** Max distance of face-box centre from frame centre, normalised. */
  maxCenterOffset: number;
  /** Min outer-eye-corner span as a fraction of frame width. */
  minEyeSpan: number;
  /** Min Laplacian variance. Defocus guard only — see note below. */
  minSharpness: number;
  /** Min mean luma, 0–255. */
  minBrightness: number;
  /** Max fraction of crushed-to-black pixels. */
  maxUnderexposed: number;
  /** Max eyeBlink blendshape score — rejects mid-blink frames. */
  maxEyeBlink: number;
  /** Max jawOpen / smile scores, for a neutral-ish capture. */
  maxJawOpen: number;
  maxSmile: number;
  /** Rolling window used for the stability check. */
  stabilityWindow: number;
  /** Max peak-to-peak yaw/pitch spread across that window, degrees. */
  maxPoseJitterDeg: number;
}

export const DEFAULT_CAPTURE_GATES: CaptureGates = {
  // Measured: frontal p95 0.46°, reject-side sample 32.7°. The raw midpoint was
  // 16.6°, but that came from a prompt asking for the last ACCEPTABLE pose, so
  // it under-reports. Pinned to 15° instead: the conventional near-frontal limit
  // for face recognition, and comfortably above measured frontal noise.
  //
  // A subjective "still looks fine to me" runs well past what a face-embedding
  // comparison tolerates — the operator called 32.7° acceptable, which it is to
  // a human eye and is not to a matcher.
  maxYawDeg: 15,

  // Measured frontal pitch sat at +3.9° — that is camera height, not head pose.
  // The offset is device-specific (a phone held low would read far higher), so
  // 2× the measured p95 (9.0°) would not survive contact with other hardware.
  // Kept generous; the align phase should establish a per-session baseline and
  // gate on deviation from it rather than on the absolute value.
  maxPitchDeg: 15,

  // Roll is the one axis derived exactly rather than approximated, and measured
  // tight (frontal p95 0.11°). 10° leaves normal head tilt room without letting
  // through a rotation that would disturb landmark alignment downstream.
  maxRollDeg: 10,

  // Measured frontal 0.131 (that sample sat noticeably off-centre — other
  // scenarios ran 0.06–0.09). 0.18 accepts the measured position with headroom;
  // tighten once a better-centred frontal sample exists.
  maxCenterOffset: 0.18,

  // Measured frontal p05 0.247 vs too-far max 0.163 → 0.205. Nudged down to
  // 0.19: the too-dark sample sat at 0.206, i.e. a legitimate capture distance
  // was landing within noise of the threshold. Two independent runs bracketed
  // this at 0.197 and 0.205, so the value is well supported.
  minEyeSpan: 0.19,

  // NOT a motion gate. Measured frontal (34.6–107.5) and moving (12.1–75.7)
  // overlap across most of their range, so sharpness cannot separate a held
  // pose from a moving one on this sensor — the harness flagged exactly that.
  // Motion is caught by maxPoseJitterDeg below.
  //
  // This value only rejects gross defocus: it sits below the minimum observed
  // on any good frontal frame, so it should never reject a usable capture.
  //
  // Caveat: the fixed sampling window includes background when the face is
  // small, and background is static and textured — a distant face measured
  // SHARPER than a close one (87.9 vs 57.2). Apply minEyeSpan first.
  minSharpness: 25,

  // Measured frontal p05 134.9 vs too-dark max 34.2 — a wide, clean bracket.
  minBrightness: 85,

  // The stronger of the two exposure signals: the crushed-pixel fraction went
  // 0.000 → 0.213 between good and dark, where mean luma is easily skewed by a
  // bright background behind an underlit face.
  maxUnderexposed: 0.05,

  // Measured frontal p95 0.222, with natural blinks spiking to 0.688.
  maxEyeBlink: 0.35,

  // Expression neutrality — measured frontal jawOpen ≈0.001, smile ≈0.011, so
  // these reject deliberate expressions without policing a faint smile.
  maxJawOpen: 0.25,
  maxSmile: 0.55,

  // Stability, the actual motion gate. Measured yaw spread was 1.2° peak-to-peak
  // while held and 58° while moving — roughly two orders of magnitude apart,
  // against sharpness's heavily-overlapping distributions.
  stabilityWindow: 8,
  maxPoseJitterDeg: 6,
};
