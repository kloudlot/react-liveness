// utils/captureFrame.ts

import type { FaceBox } from './facePose';
import type { FrameQuality } from './frameQuality';
import type { HeadPose, FaceGeometry } from './facePose';

// ---------------------------------------------------------------------------
// Gate identity
// ---------------------------------------------------------------------------

export type GateId =
  | 'no_face'
  | 'multiple_faces'
  | 'too_far'
  | 'off_center'
  | 'yaw'
  | 'pitch'
  | 'roll'
  | 'unstable'
  | 'eyes_closed'
  | 'expression'
  | 'too_dark'
  | 'blurred';

export interface GateFailure {
  gate: GateId;
  /** Short, user-facing instruction for fixing it. */
  message: string;
  /** Measured value and the limit it violated, for logs and debugging. */
  value: number;
  limit: number;
}

/**
 * Pose, framing and image measurements at the moment of capture, plus the gate
 * verdict. Sent to the backend alongside the photo so a rejection can be
 * attributed to capture conditions rather than to the face itself.
 */
export interface CaptureQuality {
  pose: HeadPose | null;
  geometry: FaceGeometry | null;
  image: FrameQuality | null;
  faceCount: number;
  eyeBlink: number;
  jawOpen: number;
  smile: number;
  /** Peak-to-peak pose spread over the stability window, degrees. */
  poseJitterDeg: number;
  /** Composite desirability, 0–1. Used to pick the best frame in the window. */
  score: number;
  /** True only when every gate passed. */
  passedGates: boolean;
  /** Failing gates in evaluation order; empty when passedGates is true. */
  failures: GateFailure[];
}

// ---------------------------------------------------------------------------
// Captured frame
// ---------------------------------------------------------------------------

export interface CapturedFrame {
  /** Base64 data URL — for display, or a JSON API. */
  dataUrl: string;
  /** Lazy blob factory — for FormData / multipart upload. */
  blob: () => Promise<Blob>;
  width: number;
  height: number;
  capturedAt: Date;
  /**
   * Whether the image is horizontally flipped relative to the camera source.
   * Gated captures default to false: the canonical record for backend
   * comparison should be true camera orientation, not the mirrored preview.
   */
  mirrored: boolean;
  /** Present on gated captures; absent for a plain captureFrame() call. */
  quality?: CaptureQuality;
}

export interface CaptureFrameOptions {
  scale?: number;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  /**
   * Mirror horizontally to match the mirrored preview.
   * @default true — preserves the historical behaviour of this helper.
   */
  mirror?: boolean;
  /** Crop to a normalised region, expanded by `paddingRatio` of its own size. */
  crop?: { box: FaceBox; paddingRatio?: number };
}

// ---------------------------------------------------------------------------
// drawVideoFrame — pixels only, no encoding.
//
// Split out because best-frame selection snapshots on every improvement but
// encodes exactly once. drawImage costs ~1ms; toDataURL on a 640×480 JPEG costs
// well over ten, which is not affordable inside a 60fps loop.
// ---------------------------------------------------------------------------
export function drawVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: CaptureFrameOptions = {},
): boolean {
  const { scale = 1, mirror = true, crop } = options;

  if (video.readyState < 2 || video.videoWidth === 0) return false;

  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;

  if (crop) {
    const pad = crop.paddingRatio ?? 0;
    const padX = crop.box.width * pad;
    const padY = crop.box.height * pad;

    const x0 = Math.max(0, crop.box.x - padX);
    const y0 = Math.max(0, crop.box.y - padY);
    const x1 = Math.min(1, crop.box.x + crop.box.width + padX);
    const y1 = Math.min(1, crop.box.y + crop.box.height + padY);

    sx = x0 * video.videoWidth;
    sy = y0 * video.videoHeight;
    sw = (x1 - x0) * video.videoWidth;
    sh = (y1 - y0) * video.videoHeight;
  }

  if (sw < 1 || sh < 1) return false;

  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return true;
}

/**
 * Encode an already-prepared canvas into a CapturedFrame.
 *
 * `encodeQuality` is the JPEG compression level; `captureQuality` is the gate
 * evaluation record. Two very different things that both wanted to be called
 * "quality" — the public CaptureFrameOptions.quality already means compression,
 * so the names are explicit here.
 */
export function frameFromCanvas(
  canvas: HTMLCanvasElement,
  options: {
    format?: 'image/png' | 'image/jpeg';
    encodeQuality?: number;
    mirrored?: boolean;
    captureQuality?: CaptureQuality;
  } = {},
): CapturedFrame {
  const { format = 'image/png', encodeQuality = 0.92, mirrored = false, captureQuality } = options;

  return {
    dataUrl: canvas.toDataURL(format, encodeQuality),
    blob: () =>
      new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          format,
          encodeQuality,
        ),
      ),
    width: canvas.width,
    height: canvas.height,
    capturedAt: new Date(),
    mirrored,
    ...(captureQuality ? { quality: captureQuality } : {}),
  };
}

/**
 * Capture a single frame from a live video element.
 *
 * Mirrors by default so the result matches what the user saw. Pass
 * `mirror: false` when the image is destined for backend face comparison.
 */
export function captureFrame(
  video: HTMLVideoElement,
  options?: CaptureFrameOptions,
): CapturedFrame | null {
  const { format = 'image/png', quality = 0.92, mirror = true } = options ?? {};

  const canvas = document.createElement('canvas');
  if (!drawVideoFrame(video, canvas, options)) return null;

  return frameFromCanvas(canvas, { format, encodeQuality: quality, mirrored: mirror });
}
