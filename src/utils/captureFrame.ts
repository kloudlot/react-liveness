import { CapturedFrame } from '../types';

export interface CaptureFrameOptions {
  scale?: number;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
}

/**
 * Captures a still frame from a live <video> element.
 *
 * The canvas is mirrored to match the scaleX(-1) CSS transform applied to
 * the video in the UI, so the captured image looks natural to the user.
 *
 * Returns null if the video isn't ready or the canvas context is unavailable.
 */
export function captureFrame(
  video: HTMLVideoElement,
  options: CaptureFrameOptions = {}
): CapturedFrame | null {
  const { scale = 1, format = 'image/jpeg', quality = 0.88 } = options;

  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  * scale;
  canvas.height = video.videoHeight * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Mirror the canvas to match the scaleX(-1) on the video element
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL(format, quality);

  return {
    dataUrl,
    blob: () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
          format,
          quality
        )
      ),
    width:       canvas.width,
    height:      canvas.height,
    capturedAt:  new Date(),
  };
}