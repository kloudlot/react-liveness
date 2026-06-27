// import { useRef, useState, useCallback } from 'react';

// export interface UseCameraReturn {
//   videoRef: React.RefObject<HTMLVideoElement>;
//   isCameraReady: boolean;
//   error: string | null;
//   startCamera: () => Promise<void>;
//   stopCamera: () => void;
// }

// export function useCamera(): UseCameraReturn {
//   const videoRef      = useRef<HTMLVideoElement>(null);
//   const streamRef     = useRef<MediaStream | null>(null);
//   const [isCameraReady, setIsCameraReady] = useState(false);
//   const [error, setError]                 = useState<string | null>(null);

//   const startCamera = useCallback(async () => {
//     setError(null);
//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({
//         video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
//         audio: false,
//       });

//       streamRef.current = stream;

//       if (videoRef.current) {
//         videoRef.current.srcObject = stream;
//         await videoRef.current.play();
//         setIsCameraReady(true);
//       }
//     } catch (err) {
//       const msg =
//         err instanceof DOMException && err.name === 'NotAllowedError'
//           ? 'Camera permission denied. Please allow camera access and try again.'
//           : err instanceof Error
//           ? err.message
//           : 'Failed to start camera.';
//       setError(msg);
//     }
//   }, []);

//   const stopCamera = useCallback(() => {
//     streamRef.current?.getTracks().forEach((t) => t.stop());
//     streamRef.current = null;
//     if (videoRef.current) videoRef.current.srcObject = null;
//     setIsCameraReady(false);
//   }, []);

//   return { videoRef, isCameraReady, error, startCamera, stopCamera };
// }

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraReady(true);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow camera access and try again.');
      } else {
        setError('Could not start camera. Please check your device.');
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsCameraReady(false);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, isCameraReady, error, startCamera, stopCamera };
}