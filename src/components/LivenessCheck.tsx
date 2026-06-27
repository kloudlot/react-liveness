"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
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

export interface LivenessTheme {
  primary?: string;
  success?: string;
  danger?: string;
  warning?: string;
  background?: string;
  surface?: string;
  text?: string;
  border?: string;
}

export interface LivenessStyles {
  root?: React.CSSProperties;
  header?: React.CSSProperties;
  titleGroup?: React.CSSProperties;
  title?: React.CSSProperties;
  subtitle?: React.CSSProperties;
  secureBadge?: React.CSSProperties;
  errorBanner?: React.CSSProperties;
  cameraShell?: React.CSSProperties;
  cameraFrame?: React.CSSProperties;
  video?: React.CSSProperties;
  faceGuide?: React.CSSProperties;
  idleOverlay?: React.CSSProperties;
  loadingOverlay?: React.CSSProperties;
  resultOverlay?: React.CSSProperties;
  warningPill?: React.CSSProperties;
  capturedThumb?: React.CSSProperties;
  progressWrapper?: React.CSSProperties;
  progressTrack?: React.CSSProperties;
  progressFill?: React.CSSProperties;
  challengePills?: React.CSSProperties;
  challengePill?: React.CSSProperties;
  instructionCard?: React.CSSProperties;
  instructionIcon?: React.CSSProperties;
  instructionText?: React.CSSProperties;
  actionWrapper?: React.CSSProperties;
  actionButton?: React.CSSProperties;
  resultList?: React.CSSProperties;
  resultPill?: React.CSSProperties;
}

const defaultStyles: LivenessStyles = {
  root: {
    width: "100%",
    maxWidth: 560,
    margin: "auto",
    background: "var(--live-surface, #ffffff)",
    border: "1px solid var(--live-border, #e2e8f0)",
    borderRadius: 28,
    overflow: "hidden",
    boxShadow: "0 20px 60px rgba(15, 23, 42, 0.08)",
    fontFamily: "Inter, system-ui, sans-serif",
    position: "relative",
  },
  header: {
    padding: "20px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleGroup: {
    display: "flex",
    gap: 14,
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: 18,
    color: "var(--live-text, #0f172a)",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
  },
  secureBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#eff6ff",
    color: "var(--live-primary, #2563eb)",
    padding: "8px 12px",
    borderRadius: 999,
    fontSize: 12,
  },
  errorBanner: {
    padding: "12px 20px",
    margin: "0 20px 16px",
    background: "rgba(220, 38, 38, 0.1)",
    border: "1px solid rgba(220, 38, 38, 0.2)",
    borderRadius: 12,
    color: "var(--live-danger, #dc2626)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
  },
  cameraShell: {
    padding: 24,
    background: "var(--live-bg, #f8fafc)",
  },
  cameraFrame: {
    position: "relative",
    aspectRatio: "4 / 3",
    background: "black",
    borderRadius: 28,
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  faceGuide: {
    position: "absolute",
    inset: "50%",
    width: 220,
    height: 280,
    borderRadius: "50%",
    border: "4px solid rgba(255, 255, 255, 0.7)",
    transform: "translate(-50%, -50%)",
    transition: "border-color 0.3s ease",
  },
  idleOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 16,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    background: "rgba(15, 23, 42, 0.75)",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 16,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    background: "rgba(15, 23, 42, 0.75)",
  },
  warningPill: {
    position: "absolute",
    bottom: 18,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.72)",
    color: "white",
    fontSize: 13,
  },
  resultOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 16,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
  },
  capturedThumb: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    border: "2px solid white",
  },
  progressWrapper: {},
  progressTrack: {
    height: 8,
    margin: "0 20px 20px",
    background: "var(--live-border, #e2e8f0)",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--live-primary, #2563eb)",
    transition: "width 0.1s linear",
  },
  challengePills: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    padding: "0 20px 16px",
  },
  challengePill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 20,
    background: "var(--live-surface, #ffffff)",
    border: "2px solid var(--live-border, #e2e8f0)",
    color: "var(--live-text, #0f172a)",
    transition: "all 0.2s",
  },
  instructionCard: {
    margin: "0 20px 20px",
    padding: 18,
    borderRadius: 20,
    border: "1px solid var(--live-border, #e2e8f0)",
    display: "flex",
    gap: 16,
    alignItems: "center",
    background: "var(--live-surface, #ffffff)",
  },
  instructionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    background: "rgba(37, 99, 235, 0.1)",
    display: "grid",
    placeItems: "center",
    color: "var(--live-primary, #2563eb)",
  },
  instructionText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  actionWrapper: {
    padding: "0 20px 20px",
  },
  actionButton: {
    width: "100%",
    height: 52,
    border: "none",
    borderRadius: 16,
    background: "var(--live-primary, #2563eb)",
    color: "white",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  resultList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "0 20px 20px",
  },
  resultPill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
  },
};

const INJECTED_STYLES = `
  @keyframes liveness-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes liveness-pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.03); }
  }
`;

export interface LivenessCheckProps {
  onComplete?: (
    passed: boolean,
    results: ChallengeResult[],
    frame?: CapturedFrame,
  ) => void;
  className?: string;
  theme?: LivenessTheme;
  styles?: LivenessStyles;
}

export function LivenessCheck({
  onComplete,
  className,
  theme,
  styles: customStyles,
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
  const resultsRef = useRef<ChallengeResult[]>([]);
  const advancingRef = useRef(false);

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
        currentChallenge.timeoutMs) * 100
    : 0;

  // Compute merged styles
  const mergedStyles = {
    root: { ...defaultStyles.root, ...customStyles?.root },
    header: { ...defaultStyles.header, ...customStyles?.header },
    titleGroup: { ...defaultStyles.titleGroup, ...customStyles?.titleGroup },
    title: { ...defaultStyles.title, ...customStyles?.title },
    subtitle: { ...defaultStyles.subtitle, ...customStyles?.subtitle },
    secureBadge: { ...defaultStyles.secureBadge, ...customStyles?.secureBadge },
    errorBanner: { ...defaultStyles.errorBanner, ...customStyles?.errorBanner },
    cameraShell: { ...defaultStyles.cameraShell, ...customStyles?.cameraShell },
    cameraFrame: { ...defaultStyles.cameraFrame, ...customStyles?.cameraFrame },
    video: { ...defaultStyles.video, ...customStyles?.video },
    faceGuide: { ...defaultStyles.faceGuide, ...customStyles?.faceGuide },
    idleOverlay: { ...defaultStyles.idleOverlay, ...customStyles?.idleOverlay },
    loadingOverlay: { ...defaultStyles.loadingOverlay, ...customStyles?.loadingOverlay },
    resultOverlay: { ...defaultStyles.resultOverlay, ...customStyles?.resultOverlay },
    warningPill: { ...defaultStyles.warningPill, ...customStyles?.warningPill },
    capturedThumb: { ...defaultStyles.capturedThumb, ...customStyles?.capturedThumb },
    progressWrapper: { ...defaultStyles.progressWrapper, ...customStyles?.progressWrapper },
    progressTrack: { ...defaultStyles.progressTrack, ...customStyles?.progressTrack },
    progressFill: { ...defaultStyles.progressFill, ...customStyles?.progressFill },
    challengePills: { ...defaultStyles.challengePills, ...customStyles?.challengePills },
    challengePill: { ...defaultStyles.challengePill, ...customStyles?.challengePill },
    instructionCard: { ...defaultStyles.instructionCard, ...customStyles?.instructionCard },
    instructionIcon: { ...defaultStyles.instructionIcon, ...customStyles?.instructionIcon },
    instructionText: { ...defaultStyles.instructionText, ...customStyles?.instructionText },
    actionWrapper: { ...defaultStyles.actionWrapper, ...customStyles?.actionWrapper },
    actionButton: { ...defaultStyles.actionButton, ...customStyles?.actionButton },
    resultList: { ...defaultStyles.resultList, ...customStyles?.resultList },
    resultPill: { ...defaultStyles.resultPill, ...customStyles?.resultPill },
  };

  return (
    <div className={className} style={{ ...themeVars, ...mergedStyles.root }}>
      <style>{INJECTED_STYLES}</style>

      {/* Header */}
      <header style={mergedStyles.header}>
        <div style={mergedStyles.titleGroup}>
          <ShieldCheck size={22} />
          <div>
            <h3 style={mergedStyles.title}>Liveness Verification</h3>
            <p style={mergedStyles.subtitle}>Biometric identity confirmation</p>
          </div>
        </div>

        <div style={mergedStyles.secureBadge}>
          <Lock size={14} />
          Secure
        </div>
      </header>

      {/* Errors */}
      {(cameraError || modelError) && (
        <div style={mergedStyles.errorBanner}>
          <AlertTriangle size={16} />
          <span>{cameraError || modelError}</span>
        </div>
      )}

      {/* Camera Section */}
      <section style={mergedStyles.cameraShell}>
        <div style={mergedStyles.cameraFrame}>
          {/* Video */}
          <video
            ref={videoRef}
            width={VIDEO_W}
            height={VIDEO_H}
            style={mergedStyles.video}
            playsInline
            muted
          />

          {/* Face guide */}
          {(isActive || isDone) && (
            <div
              style={{
                ...mergedStyles.faceGuide,
                ...(faceDetected ? { borderColor: "var(--live-success, #22c55e)", animation: "liveness-pulse 1.5s infinite" } : {}),
                ...(challengePassed ? { borderColor: "var(--live-success, #22c55e)", backgroundColor: "rgba(34, 197, 94, 0.15)" } : {}),
              }}
            />
          )}

          {/* Idle overlay */}
          {status === "idle" && (
            <div style={mergedStyles.idleOverlay}>
              <Camera size={56} />
              <h3 style={{ margin: 0 }}>Camera Required</h3>
              <p style={{ margin: 0, opacity: 0.8 }}>Allow camera access to start verification</p>
            </div>
          )}

          {/* Loading overlay */}
          {status === "waiting" && (
            <div style={mergedStyles.loadingOverlay}>
              <LoaderCircle size={48} style={{ animation: "liveness-spin 1s linear infinite" }} />
              <p style={{ margin: 0 }}>
                {!isCameraReady
                  ? "Starting camera..."
                  : "Preparing face detection..."}
              </p>
            </div>
          )}

          {/* Warning */}
          {status === "detecting" && !faceDetected && (
            <div style={mergedStyles.warningPill}>
              <AlertTriangle size={14} color="var(--live-warning, #f59e0b)" />
              Center your face in the frame
            </div>
          )}

          {/* Success / Fail Overlay */}
          {isDone && (
            <div style={{ ...mergedStyles.resultOverlay, background: allPassed ? "rgba(22, 163, 74, 0.9)" : "rgba(220, 38, 38, 0.9)" }}>
              {allPassed ? <CircleCheckBig size={72} /> : <CircleX size={72} />}

              <h2 style={{ margin: 0 }}>
                {allPassed ? "Verification Successful" : "Verification Failed"}
              </h2>

              <p style={{ margin: 0, opacity: 0.9 }}>
                {allPassed
                  ? `${results.length} challenges completed`
                  : "Some challenges were not completed"}
              </p>

              {capturedFrame && (
                <div style={mergedStyles.capturedThumb}>
                  <img src={capturedFrame.dataUrl} alt="Captured" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Progress */}
      {isActive && (
        <div style={mergedStyles.progressWrapper}>
          <div style={mergedStyles.progressTrack}>
            <div
              style={{
                ...mergedStyles.progressFill,
                width: `${progressPct}`
              }}
            />
          </div>
        </div>
      )}

      {/* Challenge Pills */}
      {challenges.length > 0 && (
        <div style={mergedStyles.challengePills}>
          {challenges.map((challenge, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            const res = results[i];

            let dynamicPillStyle: React.CSSProperties = {};
            if (res?.passed) {
              dynamicPillStyle = { background: "rgba(22, 163, 74, 0.15)", borderColor: "rgba(22, 163, 74, 0.4)", color: "var(--live-success, #16a34a)" };
            } else if (done && !res?.passed) {
              dynamicPillStyle = { background: "rgba(220, 38, 38, 0.15)", borderColor: "rgba(220, 38, 38, 0.4)", color: "var(--live-danger, #dc2626)" };
            } else if (active) {
              dynamicPillStyle = { background: "rgba(37, 99, 235, 0.15)", borderColor: "rgba(37, 99, 235, 0.4)", color: "var(--live-primary, #2563eb)" };
            }

            return (
              <div
                key={i}
                style={{
                  ...mergedStyles.challengePill,
                  ...dynamicPillStyle,
                }}
              >
                <span>{challenge.icon}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Instruction Card */}
      {isActive && currentChallenge && status === "detecting" && (
        <div style={mergedStyles.instructionCard} key={instructionKey}>
          <div style={mergedStyles.instructionIcon}>
            <ScanFace size={24} />
          </div>

          <div style={mergedStyles.instructionText}>
            <h4 style={{ margin: 0, fontSize: 16 }}>{currentChallenge.instruction}</h4>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              Step {currentIndex + 1} of {challenges.length}
            </p>
          </div>
        </div>
      )}

      {/* Idle CTA */}
      {status === "idle" && (
        <div style={mergedStyles.actionWrapper}>
          <button style={mergedStyles.actionButton} onClick={handleStart}>
            Start Verification
          </button>
        </div>
      )}

      {/* Done CTA */}
      {isDone && (
        <div style={mergedStyles.actionWrapper}>
          <button style={mergedStyles.actionButton} onClick={handleReset}>
            {allPassed ? "Done" : "Try Again"}
          </button>
        </div>
      )}

      {/* Challenge Result Summary */}
      {isDone && (
        <div style={mergedStyles.resultList}>
          {results.map((result, idx) => (
            <div
              key={idx}
              style={{
                ...mergedStyles.resultPill,
                background: result.passed ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
                color: result.passed ? "var(--live-success, #16a34a)" : "var(--live-danger, #dc2626)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>{challenges[idx]?.icon}</span>
                <span>{challenges[idx]?.label || challenges[idx]?.type}</span>
              </div>

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

