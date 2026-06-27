// utils/captureFrame.ts

export interface CapturedFrame {
  dataUrl: string;           // base64 PNG — use for display or sending to backend
  blob: () => Promise<Blob>; // lazy blob — use for FormData upload
  width: number;
  height: number;
  capturedAt: Date;
}

export function captureFrame(
  video: HTMLVideoElement,
  options?: { scale?: number; format?: 'image/png' | 'image/jpeg'; quality?: number }
): CapturedFrame | null {
  const { scale = 1, format = 'image/png', quality = 0.92 } = options ?? {};

  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  * scale;
  canvas.height = video.videoHeight * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The video renders mirrored (scaleX(-1)) in the UI, but we want the
  // captured image to also appear natural (mirror-flipped), matching what
  // the user saw. Flip the canvas context to match.
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL(format, quality);

  return {
    dataUrl,
    blob: () => new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
        format,
        quality
      )
    ),
    width:  canvas.width,
    height: canvas.height,
    capturedAt: new Date(),
  };
}