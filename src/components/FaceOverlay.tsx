'use client';

import { useEffect, useRef } from 'react';

interface FaceOverlayProps {
  landmarks: { x: number; y: number; z: number }[];
  faceDetected: boolean;
  width: number;
  height: number;
  challengePassed?: boolean;
}

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
const LEFT_EYE = [33, 160, 158, 133, 153, 144, 33];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380, 362];
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];

function drawPath(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number }[],
  indices: number[],
  w: number,
  h: number
) {
  if (!indices.length) return;

  ctx.beginPath();

  const first = landmarks[indices[0]];
  if (!first) return;

  ctx.moveTo(first.x * w, first.y * h);

  for (let i = 1; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    if (pt) ctx.lineTo(pt.x * w, pt.y * h);
  }

  ctx.stroke();
}

export function FaceOverlay({
  landmarks,
  faceDetected,
  width,
  height,
  challengePassed,
}: FaceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!faceDetected || landmarks.length === 0) return;

    const color = challengePassed ? '#68D391' : '#63B3ED';
    const glowColor = challengePassed
      ? 'rgba(104, 211, 145, 0.4)'
      : 'rgba(99, 179, 237, 0.3)';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 8;

    ctx.globalAlpha = 0.7;
    drawPath(ctx, landmarks, FACE_OVAL, width, height);

    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.2;
    drawPath(ctx, landmarks, LEFT_EYE, width, height);
    drawPath(ctx, landmarks, RIGHT_EYE, width, height);

    ctx.globalAlpha = 0.6;
    drawPath(ctx, landmarks, LIPS_OUTER, width, height);

    const nose = landmarks[1];
    if (nose) {
      ctx.beginPath();
      ctx.arc(nose.x * width, nose.y * height, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }, [landmarks, faceDetected, width, height, challengePassed]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        transform: 'scaleX(-1)',
      }}
    />
  );
}