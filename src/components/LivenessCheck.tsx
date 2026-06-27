"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useCamera } from "../hooks/useCamera";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker";
import { FaceOverlay } from "./FaceOverlay";
import { ChallengeSteps } from "./ChallengeSteps";
// import { pickChallenges } from '../hooks/challenges';
import {
  BlendshapeMap,
  CapturedFrame,
  Challenge,
  ChallengeResult,
  ChallengeStatus,
} from "../types";
import { useLivenessAudio } from "../hooks/useLivenessAudio";
import { pickChallenges } from "../challenges";
import { captureFrame } from "../utils/captureFrame";
// import { Challenge, ChallengeResult, ChallengeStatus } from '../types/liveness';

// import { keyframes } from '@emotion/react';
// import { CheckIcon, MessageCircleWarningIcon, RepeatIcon } from 'lucide-react';
// import { useLivenessAudio } from '@/hooks/useLivelinessAudio';
// import { CapturedFrame, captureFrame } from '@/lib/captureFrame';

const VIDEO_W = 480;
const VIDEO_H = 360;

interface LivenessCheckProps {
  onComplete?: (
    passed: boolean,
    results: ChallengeResult[],
    frame?: CapturedFrame,
  ) => void;
}

export function LivenessCheck({ onComplete }: LivenessCheckProps) {
  const {
    videoRef,
    isCameraReady,
    error: cameraError,
    startCamera,
    stopCamera,
  } = useCamera();
  const audio = useLivenessAudio();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [status, setStatus] = useState<ChallengeStatus>("idle");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [landmarks, setLandmarks] = useState<
    { x: number; y: number; z: number }[]
  >([]);
  const [challengePassed, setChallengePassed] = useState(false);
  const [instructionKey, setInstructionKey] = useState(0);
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrame | null>(
    null,
  );

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const challengeStartRef = useRef<number>(0);
  const currentIndexRef = useRef(0);
  const statusRef = useRef<ChallengeStatus>("idle");
  const challengesRef = useRef<Challenge[]>([]);
  // Ref-tracked results so advanceChallenge always reads the latest list
  // without needing results in its dependency array (which would cause stale
  // closures or re-registration of the RAF loop on every result append).
  const resultsRef = useRef<ChallengeResult[]>([]);
  // Guards against advanceChallenge firing multiple times per challenge.
  // statusRef alone can't guard this because setStatus is async — the ref
  // stays 'detecting' during the 800ms pass-delay while the RAF loop keeps running.
  const advancingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    challengesRef.current = challenges;
  }, [challenges]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const advanceChallenge = useCallback(
    (passed: boolean, elapsed: number) => {
      // Guard: the RAF loop fires at ~60fps so advanceChallenge can be called
      // many times before React re-renders. Lock immediately on the first call
      // and ignore all subsequent calls for this challenge.
      if (advancingRef.current) return;
      advancingRef.current = true;

      clearTimer();

      const idx = currentIndexRef.current;
      const challenge = challengesRef.current[idx];
      if (!challenge) return;

      const result: ChallengeResult = {
        type: challenge.type,
        passed,
        timeMs: elapsed,
      };

      setChallengePassed(passed);

      // Play audio feedback immediately on result
      if (passed) {
        audio.announcePass();
      } else {
        audio.announceTimeout();
      }

      // Build the full results list synchronously from the ref so we never read
      // stale React state. This is the source of truth for allPassed.
      const allResults = [...resultsRef.current, result];
      setResults(allResults);

      setTimeout(
        () => {
          const nextIdx = idx + 1;

          if (nextIdx >= challengesRef.current.length) {
            // Session complete — derive pass/fail from the full authoritative list
            const sessionPassed = allResults.every((r) => r.passed);
            setStatus(sessionPassed ? "complete" : "failed");
            statusRef.current = sessionPassed ? "complete" : "failed";
            if (sessionPassed) {
              audio.announceComplete();
              // Capture the frame right now while the video is still live
              const frame = videoRef.current
                ? captureFrame(videoRef.current, {
                    format: "image/jpeg",
                    quality: 0.88,
                  })
                : null;
              if (frame) setCapturedFrame(frame);
              onComplete?.(true, allResults, frame ?? undefined);
            } else {
              audio.announceFail();
              // Still capture the frame on failure — it’s useful for fraud detection
              const frame = videoRef.current
                ? captureFrame(videoRef.current, {
                    format: "image/jpeg",
                    quality: 0.88,
                  })
                : null;
              if (frame) setCapturedFrame(frame);
              onComplete?.(false, allResults, frame ?? undefined);
            }
            // onComplete?.(sessionPassed, allResults);
            // No unlock needed — session is over
          } else {
            setCurrentIndex(nextIdx);
            currentIndexRef.current = nextIdx;
            setChallengePassed(false);
            // Unlock before starting next challenge so its RAF frames can advance
            advancingRef.current = false;
            startChallenge(nextIdx);
          }
        },
        passed ? 800 : 600,
      );
    },
    [onComplete],
  );

  const startChallenge = useCallback(
    (idx: number) => {
      const ch = challengesRef.current[idx];
      if (!ch) return;

      setStatus("detecting");
      statusRef.current = "detecting";
      setTimeRemaining(ch.timeoutMs);
      setInstructionKey((k) => k + 1);
      challengeStartRef.current = Date.now();

      // Speak the challenge instruction with a preceding ping
      audio.announceChallenge(ch.instruction);

      clearTimer();
      const interval = 100;
      let elapsed = 0;

      timerRef.current = setInterval(() => {
        elapsed += interval;
        const remaining = ch.timeoutMs - elapsed;
        setTimeRemaining(Math.max(0, remaining));

        if (remaining <= 0) {
          advanceChallenge(false, elapsed);
        }
      }, interval);
    },
    [advanceChallenge],
  );

  const handleResult = useCallback(
    ({
      blendshapes,
      faceDetected: fd,
      landmarks: lm,
    }: {
      blendshapes: BlendshapeMap;
      faceDetected: boolean;
      landmarks: { x: number; y: number; z: number }[];
    }) => {
      setFaceDetected(fd);
      setLandmarks(lm);

      if (statusRef.current !== "detecting") return;

      const idx = currentIndexRef.current;
      const challenge = challengesRef.current[idx];
      if (!challenge || !fd) return;

      const allMatch = challenge.blendshapes.every(({ key, threshold }) => {
        const score = blendshapes[key] ?? 0;
        // Negative threshold means "score must be below threshold" (e.g. TURN_RIGHT headYaw)
        return threshold < 0 ? score < threshold : score > threshold;
      });

      if (allMatch) {
        const elapsed = Date.now() - challengeStartRef.current;
        advanceChallenge(true, elapsed);
      }
    },
    [advanceChallenge],
  );

  const {
    isLoading: isModelLoading,
    error: modelError,
    startDetection,
    stopDetection,
  } = useFaceLandmarker(videoRef, {
    onResult: handleResult,
    enabled: status !== "idle",
  });

  const handleStart = useCallback(async () => {
    const picked = pickChallenges(3);
    setChallenges(picked);
    challengesRef.current = picked;
    setResults([]);
    resultsRef.current = [];
    advancingRef.current = false;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setChallengePassed(false);
    setStatus("waiting");
    statusRef.current = "waiting";

    await startCamera();
  }, [startCamera]);

  useEffect(() => {
    if (isCameraReady && !isModelLoading && status === "waiting") {
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
    setStatus("idle");
    statusRef.current = "idle";
    setFaceDetected(false);
    setLandmarks([]);
  }, [stopDetection, stopCamera]);

  useEffect(
    () => () => {
      clearTimer();
      stopDetection();
      audio.stop();
    },
    [stopDetection],
  );

  const isComplete = status === "complete";
  const isFailed = status === "failed";
  const isDone = isComplete || isFailed;
  const isActive = status === "detecting" || status === "waiting";
  const currentChallenge = challenges[currentIndex];

  const allPassed = isDone && results.every((r) => r.passed);

  return (
    <div
      style={{
        background: "#111827",
        borderRadius: 24,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
        maxWidth: 520,
        width: "100%",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(to right, #111827, #1f2937)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "#63b3ed",
                fontWeight: 700,
              }}
            >
              Identity Verification
            </div>
            <h3 style={{ color: "white", margin: 0 }}>Liveness Check</h3>
          </div>

          {isActive && (
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: faceDetected ? "#14532d" : "#7c2d12",
                color: "white",
              }}
            >
              {faceDetected ? "● Face detected" : "○ No face"}
            </div>
          )}
        </div>
      </div>

      {/* Camera */}
      <div
        style={{
          position: "relative",
          background: "black",
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          width={VIDEO_W}
          height={VIDEO_H}
          style={{
            maxWidth: "100%",
            display: isActive || isDone ? "block" : "none",
            transform: "scaleX(-1)",
            objectFit: "cover",
          }}
          playsInline
          muted
        />

        {isActive && landmarks.length > 0 && (
          <FaceOverlay
            landmarks={landmarks}
            faceDetected={faceDetected}
            width={VIDEO_W}
            height={VIDEO_H}
            challengePassed={challengePassed}
          />
        )}

        {status === "idle" && (
          <div
            style={{
              width: VIDEO_W,
              height: VIDEO_H,
              maxWidth: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#030712",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 48 }}>🎥</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
              Camera preview will appear here
            </div>
          </div>
        )}

        {status === "waiting" && (isModelLoading || !isCameraReady) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.8)",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: "3px solid rgba(255,255,255,0.2)",
                borderTop: "3px solid #63b3ed",
                animation: "spin 1s linear infinite",
              }}
            />
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>
              {!isCameraReady
                ? "Starting camera..."
                : "Loading face detection model..."}
            </div>
          </div>
        )}

        {status === "detecting" && faceDetected && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 180,
              height: 220,
              border: `2px solid ${challengePassed ? "#68D391" : "#63B3ED"}`,
              borderRadius: "9999px",
              animation: "pulse 2s ease-in-out infinite",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
        )}

        {status === "detecting" && !faceDetected && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.8)",
              padding: "6px 12px",
              borderRadius: 9999,
              border: "1px solid #ed8936",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#f6ad55",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              ⚠ Position your face in the frame
            </div>
          </div>
        )}

        {isDone && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: allPassed ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.8)",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: allPassed ? "#48bb78" : "#f56565",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "pop 0.4s ease-out",
              }}
            >
              {allPassed ? (
                <p color="white">passedicon</p>
              ) : (
                <p color="white">failedicon</p>
              )}
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ color: "white", fontWeight: 700, fontSize: 18 }}>
                {allPassed ? "Verification Passed!" : "Verification Failed"}
              </div>

              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                {allPassed
                  ? `${results.filter((r) => r.passed).length}/${results.length} challenges completed`
                  : "Not all challenges were completed in time"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom */}
      <div style={{ padding: "20px 24px", background: "#111827" }}>
        {(cameraError || modelError) && (
          <div
            style={{
              background: "#7f1d1d",
              color: "#fecaca",
              padding: 16,
              borderRadius: 12,
              marginBottom: 16,
            }}
          >
            {cameraError || modelError}
          </div>
        )}

        {status === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                color: "rgba(255,255,255,0.7)",
                textAlign: "center",
                fontSize: 14,
              }}
            >
              We'll ask you to perform a few simple actions to verify you're a
              real person.
            </div>

            <button
              onClick={handleStart}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "none",
                background: "#2563eb",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Start Verification
            </button>
          </div>
        )}

        {isActive && challenges.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ChallengeSteps
              challenges={challenges}
              currentIndex={currentIndex}
              results={results}
              timeRemaining={timeRemaining}
              totalTime={currentChallenge?.timeoutMs ?? 5000}
            />
          </div>
        )}
      </div>
    </div>
  );
}
