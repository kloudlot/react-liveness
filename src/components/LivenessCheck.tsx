'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useLivenessAudio } from '../hooks/useLivenessAudio';
import { pickChallenges } from '../challenges';
import { captureFrame } from '../utils/captureFrame';
import {
  Challenge,
  ChallengeResult,
  ChallengeStatus,
  CapturedFrame,
  LivenessCheckProps,
  BlendshapeMap,
} from '../types';

const VIDEO_W = 480;
const VIDEO_H = 360;

export function LivenessCheck({
  onComplete,
  challenges: challengesProp,
  challengeCount = 3,
  muted = false,
  className,
}: LivenessCheckProps) {
  const { videoRef, isCameraReady, error: cameraError, startCamera, stopCamera } = useCamera();
  const audio = useLivenessAudio(muted);

  const [challenges, setChallenges]         = useState<Challenge[]>([]);
  const [currentIndex, setCurrentIndex]     = useState(0);
  const [results, setResults]               = useState<ChallengeResult[]>([]);
  const [status, setStatus]                 = useState<ChallengeStatus>('idle');
  const [timeRemaining, setTimeRemaining]   = useState(0);
  const [faceDetected, setFaceDetected]     = useState(false);
  const [landmarks, setLandmarks]           = useState<{ x: number; y: number; z: number }[]>([]);
  const [challengePassed, setChallengePassed] = useState(false);
  const [capturedFrameState, setCapturedFrameState] = useState<CapturedFrame | null>(null);

  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const challengeStartRef = useRef<number>(0);
  const currentIndexRef   = useRef(0);
  const statusRef         = useRef<ChallengeStatus>('idle');
  const challengesRef     = useRef<Challenge[]>([]);
  const resultsRef        = useRef<ChallengeResult[]>([]);
  const advancingRef      = useRef(false);

  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { challengesRef.current = challenges; }, [challenges]);
  useEffect(() => { resultsRef.current = results; }, [results]);

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const advanceChallenge = useCallback((passed: boolean, elapsed: number) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    clearTimer();

    const idx       = currentIndexRef.current;
    const challenge = challengesRef.current[idx];
    if (!challenge) return;

    const result: ChallengeResult = { type: challenge.type, passed, timeMs: elapsed };
    setChallengePassed(passed);

    if (passed) audio.announcePass(); else audio.announceTimeout();

    const allResults = [...resultsRef.current, result];
    setResults(allResults);

    setTimeout(() => {
      const nextIdx = idx + 1;

      if (nextIdx >= challengesRef.current.length) {
        const sessionPassed = allResults.every((r) => r.passed);
        setStatus(sessionPassed ? 'complete' : 'failed');
        statusRef.current = sessionPassed ? 'complete' : 'failed';

        if (sessionPassed) {
          audio.announceComplete();
          const frame = videoRef.current
            ? captureFrame(videoRef.current, { format: 'image/jpeg', quality: 0.88 })
            : null;
          if (frame) setCapturedFrameState(frame);
          onComplete?.(true, allResults, frame ?? undefined);
        } else {
          audio.announceFail();
          onComplete?.(false, allResults);
        }
      } else {
        setCurrentIndex(nextIdx);
        currentIndexRef.current = nextIdx;
        setChallengePassed(false);
        advancingRef.current = false;
        startChallenge(nextIdx);
      }
    }, passed ? 800 : 600);
  }, [onComplete, audio, videoRef]);

  const startChallenge = useCallback((idx: number) => {
    const ch = challengesRef.current[idx];
    if (!ch) return;

    advancingRef.current = false;
    setStatus('detecting');
    statusRef.current = 'detecting';
    setTimeRemaining(ch.timeoutMs);
    challengeStartRef.current = Date.now();

    audio.announceChallenge(ch.instruction);

    clearTimer();
    const interval = 100;
    let elapsed = 0;

    timerRef.current = setInterval(() => {
      elapsed += interval;
      const remaining = ch.timeoutMs - elapsed;
      setTimeRemaining(Math.max(0, remaining));
      if (remaining <= 0) advanceChallenge(false, elapsed);
    }, interval);
  }, [advanceChallenge, audio]);

  const handleResult = useCallback(
    ({ blendshapes, faceDetected: fd, landmarks: lm }: {
      blendshapes: BlendshapeMap;
      faceDetected: boolean;
      landmarks: { x: number; y: number; z: number }[];
    }) => {
      setFaceDetected(fd);
      setLandmarks(lm);

      if (statusRef.current !== 'detecting') return;

      const idx       = currentIndexRef.current;
      const challenge = challengesRef.current[idx];
      if (!challenge || !fd) return;

      const allMatch = challenge.blendshapes.every(({ key, threshold }) => {
        const score = blendshapes[key] ?? 0;
        return threshold < 0 ? score < threshold : score > threshold;
      });

      if (allMatch) advanceChallenge(true, Date.now() - challengeStartRef.current);
    },
    [advanceChallenge]
  );

  const { isLoading: isModelLoading, error: modelError, startDetection, stopDetection } =
    useFaceLandmarker(videoRef, { onResult: handleResult, enabled: status !== 'idle' });

  const handleStart = useCallback(async () => {
    const picked = challengesProp ?? pickChallenges(challengeCount);
    setChallenges(picked);
    challengesRef.current = picked;
    setResults([]);
    resultsRef.current = [];
    advancingRef.current = false;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setChallengePassed(false);
    setCapturedFrameState(null);
    setStatus('waiting');
    statusRef.current = 'waiting';
    await startCamera();
  }, [startCamera, challengesProp, challengeCount]);

  useEffect(() => {
    if (isCameraReady && !isModelLoading && status === 'waiting') {
      startDetection();
      startChallenge(0);
    }
  }, [isCameraReady, isModelLoading, status, startDetection, startChallenge]);

  const handleReset = useCallback(() => {
    clearTimer();
    advancingRef.current = false;
    audio.stop();
    stopDetection();
    stopCamera();
    setChallenges([]);
    setResults([]);
    resultsRef.current = [];
    setCurrentIndex(0);
    setChallengePassed(false);
    setCapturedFrameState(null);
    setStatus('idle');
    statusRef.current = 'idle';
    setFaceDetected(false);
    setLandmarks([]);
  }, [stopDetection, stopCamera, audio]);

  useEffect(() => () => { clearTimer(); stopDetection(); audio.stop(); }, [stopDetection, audio]);

  const isComplete = status === 'complete';
  const isFailed   = status === 'failed';
  const isDone     = isComplete || isFailed;
  const isActive   = status === 'detecting' || status === 'waiting';
  const allPassed  = isDone && results.every((r) => r.passed);
  const currentChallenge = challenges[currentIndex];
  const progressPct = currentChallenge
    ? ((currentChallenge.timeoutMs - timeRemaining) / currentChallenge.timeoutMs) * 100
    : 0;

  return (
    <div
      className={className}
      style={{
        background: '#111827',
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        maxWidth: 520,
        width: '100%',
        margin: '0 auto',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0f172a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#93c5fd', fontWeight: 700, marginBottom: 2 }}>
              Identity Verification
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Liveness Check</div>
          </div>
          {isActive && (
            <span style={{
              fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
              padding: '3px 8px', borderRadius: 6,
              background: faceDetected ? 'rgba(34,197,94,0.15)' : 'rgba(251,146,60,0.15)',
              color: faceDetected ? '#4ade80' : '#fb923c',
            }}>
              {faceDetected ? '● Face detected' : '○ No face'}
            </span>
          )}
        </div>
      </div>

      {/* Camera */}
      <div style={{ position: 'relative', background: '#000', lineHeight: 0 }}>
        <video
          ref={videoRef}
          width={VIDEO_W}
          height={VIDEO_H}
          style={{
            display: isActive || isDone ? 'block' : 'none',
            transform: 'scaleX(-1)',
            objectFit: 'cover',
            maxWidth: '100%',
          }}
          playsInline
          muted
        />

        {/* Idle placeholder */}
        {status === 'idle' && (
          <div style={{ width: VIDEO_W, height: VIDEO_H, maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#030712', gap: 12 }}>
            <span style={{ fontSize: 48 }}>🎥</span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Camera preview will appear here</span>
          </div>
        )}

        {/* Loading overlay */}
        {status === 'waiting' && (isModelLoading || !isCameraReady) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', gap: 12 }}>
            <div style={{ width: 36, height: 36, border: '3px solid #93c5fd', borderTopColor: 'transparent', borderRadius: '50%', animation: 'liveness-spin 0.8s linear infinite' }} />
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500 }}>
              {!isCameraReady ? 'Starting camera…' : 'Loading face model…'}
            </span>
          </div>
        )}

        {/* Pulse ring */}
        {status === 'detecting' && faceDetected && !challengePassed && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 180, height: 220,
            border: '2px solid #93c5fd',
            borderRadius: '50%',
            pointerEvents: 'none',
            opacity: 0.4,
            animation: 'liveness-pulse 2s ease-in-out infinite',
          }} />
        )}

        {/* No face warning */}
        {status === 'detecting' && !faceDetected && (
          <div style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)', padding: '6px 14px', borderRadius: 999,
            border: '1px solid #f97316', whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 11, color: '#fb923c', fontWeight: 600 }}>⚠ Position your face in the frame</span>
          </div>
        )}

        {/* Done overlay */}
        {isDone && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: allPassed ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.75)', gap: 12,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: allPassed ? '#16a34a' : '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, animation: 'liveness-pop 0.4s ease-out',
            }}>
              {allPassed ? '✓' : '✗'}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>
                {allPassed ? 'Verification Passed!' : 'Verification Failed'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
                {allPassed
                  ? `${results.filter((r) => r.passed).length}/${results.length} challenges completed`
                  : 'Not all challenges were completed in time'}
              </div>
            </div>
            {/* Captured frame thumbnail */}
            {capturedFrameState && (
              <div style={{
                position: 'absolute', bottom: 12, right: 12,
                width: 80, height: 60, borderRadius: 8, overflow: 'hidden',
                border: '2px solid #4ade80', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}>
                <img src={capturedFrameState.dataUrl} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div style={{ padding: '20px 24px', background: '#111827' }}>
        {/* Errors */}
        {(cameraError || modelError) && (
          <div style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
            ⚠ {cameraError || modelError}
          </div>
        )}

        {/* Idle */}
        {status === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', margin: 0 }}>
              We'll ask you to perform a few simple actions to verify you're a real person.
            </p>
            <button
              onClick={handleStart}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
                background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', letterSpacing: '0.03em',
              }}
            >
              Start Verification
            </button>
          </div>
        )}

        {/* Active */}
        {isActive && challenges.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {challenges.map((ch, i) => {
                const done   = i < currentIndex;
                const active = i === currentIndex;
                const res    = results[i];
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                    borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: done
                      ? (res?.passed ? 'rgba(34,197,94,0.15)' : 'rgba(220,38,38,0.15)')
                      : active ? 'rgba(37,99,235,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${done
                      ? (res?.passed ? 'rgba(34,197,94,0.4)' : 'rgba(220,38,38,0.4)')
                      : active ? 'rgba(37,99,235,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    color: done
                      ? (res?.passed ? '#4ade80' : '#f87171')
                      : active ? '#93c5fd' : 'rgba(255,255,255,0.3)',
                  }}>
                    <span>{ch.icon}</span>
                    <span>{done ? (res?.passed ? '✓' : '✗') : ch.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${progressPct}%`,
                background: progressPct > 80 ? '#ef4444' : '#2563eb',
                transition: 'width 0.1s linear, background 0.3s',
              }} />
            </div>

            {/* Instruction */}
            {currentChallenge && status === 'detecting' && (
              <div style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: 12,
                padding: '16px 20px', textAlign: 'center',
                border: '1px solid rgba(37,99,235,0.3)',
              }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{currentChallenge.icon}</div>
                <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
                  {currentChallenge.instruction}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Challenge {currentIndex + 1} of {challenges.length}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {results.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                  borderRadius: 8, fontSize: 10, fontWeight: 700,
                  background: r.passed ? 'rgba(34,197,94,0.15)' : 'rgba(220,38,38,0.15)',
                  color: r.passed ? '#4ade80' : '#f87171',
                }}>
                  <span>{challenges[i]?.icon}</span>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {r.passed ? `✓ ${(r.timeMs / 1000).toFixed(1)}s` : '✗ timeout'}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={handleReset}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 10,
                border: allPassed ? 'none' : '1px solid rgba(255,255,255,0.2)',
                background: allPassed ? '#16a34a' : 'transparent',
                color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              {allPassed ? 'Done' : 'Try Again'}
            </button>
          </div>
        )}
      </div>

      {/* Keyframe animations via injected <style> */}
      <style>{`
        @keyframes liveness-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes liveness-pulse {
          0%   { transform: translate(-50%,-50%) scale(0.95); opacity: 0.6; }
          70%  { transform: translate(-50%,-50%) scale(1.05); opacity: 0.2; }
          100% { transform: translate(-50%,-50%) scale(0.95); opacity: 0.6; }
        }
        @keyframes liveness-pop {
          0%   { transform: scale(0); }
          60%  { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}