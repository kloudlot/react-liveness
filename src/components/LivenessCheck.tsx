"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useCamera } from "../hooks/useCamera";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker";
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

import {
  ShieldCheck,
  Camera,
  LoaderCircle,
  AlertTriangle,
  CircleCheckBig,
  CircleX,
  ScanFace,
  Lock,
} from "lucide-react";


const VIDEO_W = 480;
const VIDEO_H = 360;

interface LivenessTheme {
  primary?: string;
  success?: string;
  danger?: string;
  warning?: string;
  background?: string;
  surface?: string;
  text?: string;
  border?: string;
}

interface LivenessCheckProps {
  onComplete?: (
    passed: boolean,
    results: ChallengeResult[],
    frame?: CapturedFrame,
  ) => void;
  className?: string;
  theme?: LivenessTheme;
}

export function LivenessCheck({
  onComplete,
  className,
  theme,
}: LivenessCheckProps) {
  const {
    videoRef,
    isCameraReady,
    error: cameraError,
    startCamera,
    stopCamera,
  } = useCamera();

  const themeVars = {
    "--live-primary": theme?.primary || "#2563eb",
    "--live-success": theme?.success || "#16a34a",
    "--live-danger": theme?.danger || "#dc2626",
    "--live-warning": theme?.warning || "#f59e0b",
    "--live-bg": theme?.background || "#f8fafc",
    "--live-surface": theme?.surface || "#ffffff",
    "--live-text": theme?.text || "#0f172a",
    "--live-border": theme?.border || "#e2e8f0",
  } as React.CSSProperties;

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

  const progressPct = currentChallenge
    ? ((currentChallenge.timeoutMs - timeRemaining) /
        currentChallenge.timeoutMs) *
      100
    : 0;

  return (
    <div className={`liveness-root ${className || ""}`} style={themeVars}>
      {/* Header */}
      <header className="liveness-header">
        <div className="title-group">
          <ShieldCheck size={22} />
          <div>
            <h3>Liveness Verification</h3>
            <p>Biometric identity confirmation</p>
          </div>
        </div>

        <div className="secure-badge">
          <Lock size={14} />
          Secure
        </div>
      </header>

      {/* Errors */}
      {(cameraError || modelError) && (
        <div className="error-banner">
          <AlertTriangle size={16} />
          <span>{cameraError || modelError}</span>
        </div>
      )}

      {/* Camera Section */}
      <section className="camera-shell">
        <div className="camera-frame">
          {/* Video */}
          <video
            ref={videoRef}
            width={VIDEO_W}
            height={VIDEO_H}
            className="camera-video"
            playsInline
            muted
          />

          {/* Face guide */}
          {(isActive || isDone) && (
            <div
              className={`face-guide ${
                faceDetected ? "detected" : ""
              } ${challengePassed ? "passed" : ""}`}
            />
          )}

          {/* Idle overlay */}
          {status === "idle" && (
            <div className="idle-overlay">
              <Camera size={56} />
              <h3>Camera Required</h3>
              <p>Allow camera access to start verification</p>
            </div>
          )}

          {/* Loading overlay */}
          {status === "waiting" && (
            <div className="loading-overlay">
              <LoaderCircle size={48} className="spin" />
              <p>
                {!isCameraReady
                  ? "Starting camera..."
                  : "Preparing face detection..."}
              </p>
            </div>
          )}

          {/* Warning */}
          {status === "detecting" && !faceDetected && (
            <div className="warning-pill">
              <AlertTriangle size={14} />
              Center your face in the frame
            </div>
          )}

          {/* Success / Fail Overlay */}
          {isDone && (
            <div className="result-overlay">
              {allPassed ? <CircleCheckBig size={72} /> : <CircleX size={72} />}

              <h2>
                {allPassed ? "Verification Successful" : "Verification Failed"}
              </h2>

              <p>
                {allPassed
                  ? `${results.length} challenges completed`
                  : "Some challenges were not completed"}
              </p>

              {capturedFrame && (
                <div className="captured-thumb">
                  <img src={capturedFrame.dataUrl} alt="Captured" />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Progress */}
      {isActive && (
        <div className="progress-wrapper">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${progressPct}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Challenge Pills */}
      {challenges.length > 0 && (
        <div className="challenge-pills">
          {challenges.map((challenge, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            const res = results[i];

            return (
              <div
                key={i}
                className={`challenge-pill
                ${done ? "done" : ""}
                ${active ? "active" : ""}
                ${res?.passed ? "passed" : ""}
                ${res && !res.passed ? "failed" : ""}
              `}
              >
                <span>{challenge.icon}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Instruction Card */}
      {isActive && currentChallenge && status === "detecting" && (
        <div className="instruction-card">
          <div className="instruction-icon">
            <ScanFace size={24} />
          </div>

          <div className="instruction-text">
            <h4>{currentChallenge.instruction}</h4>
            <p>
              Step {currentIndex + 1} of {challenges.length}
            </p>
          </div>
        </div>
      )}

      {/* Idle CTA */}
      {status === "idle" && (
        <div className="action-wrapper">
          <button className="action-button" onClick={handleStart}>
            Start Verification
          </button>
        </div>
      )}

      {/* Done CTA */}
      {isDone && (
        <div className="action-wrapper">
          <button className="action-button" onClick={handleReset}>
            {allPassed ? "Done" : "Try Again"}
          </button>
        </div>
      )}

      {/* Challenge Result Summary */}
      {isDone && (
        <div className="result-list">
          {results.map((result, idx) => (
            <div
              key={idx}
              className={`result-pill ${result.passed ? "success" : "fail"}`}
            >
              <span>{challenges[idx]?.icon}</span>

              <span>
                {result.passed
                  ? `${(result.timeMs / 1000).toFixed(1)}s`
                  : "timeout"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
