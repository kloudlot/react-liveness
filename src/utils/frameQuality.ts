// utils/frameQuality.ts
//
// Cheap per-frame image-quality measurement: focus/motion blur and exposure.
//
// This module measures only — it deliberately does not score or gate. Threshold
// policy belongs with the capture gate so that measurement stays reusable and
// independently testable.
//
// Cost is ~0.2ms per call: everything runs on a 96×96 downscale, reusing one
// module-level canvas so there is no per-frame allocation.

import type { FaceBox } from './facePose';

/** Side length, in native video pixels, of the window sampled per frame. */
const SAMPLE_SIZE = 96;

// Sharpness is a raw variance with no natural upper bound, so it is squashed
// into 0–1 by score = v / (v + K). K is the variance at which score hits 0.5,
// so it should sit near the median sharpness of a good frame — that puts a
// typical capture mid-scale with headroom in both directions.
//
// Calibrated 2026-08-03 (MacBook built-in camera, 1:1 native sampling): median
// sharpness of a good frontal frame measured 57.2.
//
// MUST be re-measured after any change to the sampling geometry above — the
// switch to 1:1 native sampling changed this figure by more than an order of
// magnitude versus the rescaled version that preceded it.
const SHARPNESS_HALF_SCORE = 57;

// Luma thresholds for clipped pixels.
const UNDEREXPOSED_LUMA = 16;
const OVEREXPOSED_LUMA = 240;

let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | null = null;

function getSampleContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;

  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = SAMPLE_SIZE;
    sampleCanvas.height = SAMPLE_SIZE;
    // getImageData every frame is the whole point of this canvas; without the
    // hint browsers keep it GPU-backed and each read forces a stall.
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }

  return sampleCtx;
}

export interface FrameQuality {
  /** Variance of the Laplacian. Higher is sharper. Unbounded, sensor-dependent. */
  sharpness: number;
  /** `sharpness` squashed to 0–1. Use this for thresholds. */
  sharpnessScore: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Fraction of sampled pixels crushed to black, 0–1. */
  underexposed: number;
  /** Fraction of sampled pixels blown out to white, 0–1. */
  overexposed: number;
}

export interface MeasureOptions {
  /**
   * Centre measurement on this normalised region of the frame. Strongly
   * recommended: a sharp background behind a blurred face reads as a sharp
   * frame when measured whole.
   */
  region?: FaceBox;
}

/**
 * Measure focus and exposure for a video frame, centred on the face region.
 * Returns null if the video has no decodable frame yet, or without a DOM.
 *
 * IMPORTANT — sharpness is only comparable between frames whose face is a
 * similar size. Apply the face-size gate FIRST and treat sharpness as a
 * focus/motion check on frames that already passed it. See the sampling note
 * below for why an absolute sharpness threshold cannot stand on its own.
 */
export function measureFrameQuality(
  video: HTMLVideoElement,
  options: MeasureOptions = {},
): FrameQuality | null {
  const { region } = options;

  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const ctx = getSampleContext();
  if (!ctx) return null;

  // Sample a fixed window of NATIVE pixels centred on the face, never rescaled.
  //
  // The first version scaled the whole face region into SAMPLE_SIZE², which made
  // sharpness a function of distance as much as focus: measured on one device,
  // an identical face at identical focus read 846 at arm's length and 236 a
  // couple of steps back, purely because the smaller region was upsampled more.
  // Any absolute threshold derived from that is meaningless. Sampling 1:1 keeps
  // the Laplacian measuring real sensor detail.
  //
  // Trade-off: when the face is smaller than the window the sample includes
  // background. That is acceptable because the size gate rejects those frames
  // before sharpness is consulted.
  const maxW = Math.min(SAMPLE_SIZE, video.videoWidth);
  const maxH = Math.min(SAMPLE_SIZE, video.videoHeight);

  let sx = (video.videoWidth - maxW) / 2;
  let sy = (video.videoHeight - maxH) / 2;

  if (region) {
    const cx = (region.x + region.width / 2) * video.videoWidth;
    const cy = (region.y + region.height / 2) * video.videoHeight;
    sx = Math.min(Math.max(0, cx - maxW / 2), video.videoWidth - maxW);
    sy = Math.min(Math.max(0, cy - maxH / 2), video.videoHeight - maxH);
  }

  const sw = maxW;
  const sh = maxH;

  if (sw < 3 || sh < 3) return null;

  let pixels: Uint8ClampedArray;
  try {
    // Destination matches the source rect exactly — 1:1, no resampling.
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    pixels = ctx.getImageData(0, 0, sw, sh).data;
  } catch {
    // Tainted canvas (cross-origin stream) or a transient decode failure.
    return null;
  }

  // Grayscale pass — Rec. 601 luma.
  const gray = new Float32Array(sw * sh);
  let lumaSum = 0;
  let under = 0;
  let over = 0;

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const luma = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    gray[i] = luma;
    lumaSum += luma;
    if (luma < UNDEREXPOSED_LUMA) under++;
    else if (luma > OVEREXPOSED_LUMA) over++;
  }

  // Laplacian pass over interior pixels: 4·centre − (up + down + left + right).
  // The variance of that response is a standard, cheap focus measure — it
  // collapses toward zero on blurred or motion-smeared frames.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - sw] - gray[i + sw];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;
    }
  }

  const lapMean = lapSum / lapCount;
  const sharpness = Math.max(0, lapSqSum / lapCount - lapMean * lapMean);

  return {
    sharpness,
    sharpnessScore: sharpness / (sharpness + SHARPNESS_HALF_SCORE),
    brightness: lumaSum / gray.length,
    underexposed: under / gray.length,
    overexposed: over / gray.length,
  };
}

/** Release the shared sampling canvas. Optional — call on teardown if desired. */
export function releaseQualityCanvas(): void {
  sampleCanvas = null;
  sampleCtx = null;
}
