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

import { Camera, LoaderCircle, CircleAlert } from "lucide-react";

const VIDEO_W = 480;
const VIDEO_H = 360;

// Ring geometry, in the proportions of the reference design: the progress ring
// sits just outside the camera circle with a small gap.
const RING_SIZE = 288;
const RING_R = 138;
const RING_STROKE = 6;
const CIRCLE_SIZE = 248;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

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
  statusDot?: React.CSSProperties;
  title?: React.CSSProperties;
  orgBadge?: React.CSSProperties;
  errorBanner?: React.CSSProperties;
  cameraShell?: React.CSSProperties;
  ringWrap?: React.CSSProperties;
  cameraFrame?: React.CSSProperties;
  video?: React.CSSProperties;
  faceGuide?: React.CSSProperties;
  liveBadge?: React.CSSProperties;
  feedLabel?: React.CSSProperties;
  centerOverlay?: React.CSSProperties;
  stateLabel?: React.CSSProperties;
  headline?: React.CSSProperties;
  headlineTitle?: React.CSSProperties;
  headlineSubtitle?: React.CSSProperties;
  stepIndicator?: React.CSSProperties;
  stepDot?: React.CSSProperties;
  stepDotActive?: React.CSSProperties;
  stepCounter?: React.CSSProperties;
  cuePill?: React.CSSProperties;
  cueDot?: React.CSSProperties;
  cueText?: React.CSSProperties;
  identityRow?: React.CSSProperties;
  actionWrapper?: React.CSSProperties;
  actionButton?: React.CSSProperties;
  cancelLink?: React.CSSProperties;
  fallbackLink?: React.CSSProperties;
}

const FONT_SANS = "'Space Grotesk', system-ui, sans-serif";
const FONT_MONO = "'Space Mono', ui-monospace, monospace";

const defaultStyles: LivenessStyles = {
  root: {
    width: "100%",
    maxWidth: 420,
    margin: "auto",
    background:
      "radial-gradient(135% 80% at 50% -8%, color-mix(in srgb, var(--live-primary, #6ee7c4) 16%, var(--live-bg, #0c0e13)) 0%, var(--live-bg, #0c0e13) 52%, var(--live-bg-deep, #090a0e) 100%)",
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.08))",
    borderRadius: 32,
    overflow: "hidden",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
    fontFamily: FONT_SANS,
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "22px 26px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleGroup: {
    display: "flex",
    gap: 9,
    alignItems: "center",
  },
  statusDot: {
    width: 11,
    height: 11,
    borderRadius: "50%",
    background: "var(--live-primary, #6ee7c4)",
    boxShadow: "0 0 12px var(--live-primary, #6ee7c4)",
    flex: "none",
  },
  title: {
    margin: 0,
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--live-text, #f2f4f2)",
  },
  orgBadge: {
    fontFamily: FONT_MONO,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "var(--live-muted, #8a9a94)",
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.1))",
    padding: "5px 11px",
    borderRadius: 20,
    fontSize: 10,
  },
  errorBanner: {
    padding: "11px 16px",
    margin: "16px 24px 0",
    background: "color-mix(in srgb, var(--live-danger, #ff8f73) 10%, transparent)",
    border: "1px solid color-mix(in srgb, var(--live-danger, #ff8f73) 22%, transparent)",
    borderRadius: 14,
    color: "var(--live-danger, #ff8f73)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  },
  cameraShell: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "18px 20px 4px",
  },
  ringWrap: {
    position: "relative",
    width: RING_SIZE,
    height: RING_SIZE,
    maxWidth: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraFrame: {
    position: "relative",
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: "50%",
    overflow: "hidden",
    background: "#14161b",
    boxShadow: "inset 0 0 46px rgba(0, 0, 0, 0.55)",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  faceGuide: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 140,
    height: 176,
    borderRadius: "50% 50% 47% 47%",
    border: "1.6px dashed color-mix(in srgb, var(--live-primary, #6ee7c4) 50%, transparent)",
    transform: "translate(-50%, -52%)",
    transition: "border-color 0.3s ease",
  },
  liveBadge: {
    // Centred rather than corner-pinned: inside a circular mask a top-left
    // corner falls outside the clip and the label gets cut off.
    position: "absolute",
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FONT_MONO,
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: "0.14em",
    color: "rgba(255, 255, 255, 0.5)",
  },
  feedLabel: {
    position: "absolute",
    bottom: 22,
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: "0.16em",
    color: "rgba(255, 255, 255, 0.32)",
  },
  centerOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    textAlign: "center",
    padding: "0 28px",
    color: "var(--live-text, #f4f7f5)",
  },
  stateLabel: {
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: "0.16em",
  },
  headline: {
    flex: "none",
    padding: "6px 34px 0",
    textAlign: "center",
  },
  headlineTitle: {
    margin: 0,
    fontSize: 26,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--live-text, #f4f7f5)",
  },
  headlineSubtitle: {
    margin: "8px 0 0",
    fontSize: 14,
    lineHeight: 1.45,
    color: "var(--live-muted, #93a19b)",
  },
  stepIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    padding: "20px 20px 0",
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--live-border, rgba(255, 255, 255, 0.16))",
    transition: "all 0.2s",
    flex: "none",
  },
  stepDotActive: {
    width: 24,
    height: 8,
    borderRadius: 5,
    background: "var(--live-primary, #6ee7c4)",
    boxShadow: "0 0 10px color-mix(in srgb, var(--live-primary, #6ee7c4) 60%, transparent)",
  },
  stepCounter: {
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--live-muted, #6c7c75)",
    marginLeft: 6,
  },
  cuePill: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.08))",
    padding: "9px 15px",
    borderRadius: 22,
    margin: "15px auto 0",
    width: "fit-content",
  },
  cueDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--live-primary, #6ee7c4)",
    flex: "none",
  },
  cueText: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: "0.04em",
    color: "var(--live-muted, #b9c6c0)",
  },
  identityRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 12,
    background: "color-mix(in srgb, var(--live-primary, #6ee7c4) 8%, transparent)",
    border: "1px solid color-mix(in srgb, var(--live-primary, #6ee7c4) 20%, transparent)",
    padding: "12px 18px",
    borderRadius: 16,
    margin: "18px 26px 0",
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "var(--live-muted, #8fb8ad)",
  },
  actionWrapper: {
    padding: "20px 26px 0",
  },
  actionButton: {
    width: "100%",
    border: "none",
    borderRadius: 16,
    background: "var(--live-primary, #6ee7c4)",
    color: "var(--live-on-primary, #06231b)",
    fontSize: 16,
    fontWeight: 600,
    padding: 16,
    cursor: "pointer",
    fontFamily: FONT_SANS,
    boxShadow: "0 12px 30px -10px color-mix(in srgb, var(--live-primary, #6ee7c4) 50%, transparent)",
  },
  cancelLink: {
    display: "block",
    textAlign: "center",
    margin: "15px auto 0",
    padding: 0,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--live-muted, #6c7c75)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: FONT_SANS,
  },
  fallbackLink: {
    display: "block",
    textAlign: "center",
    margin: "13px auto 0",
    padding: 0,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--live-muted, #8a7a74)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: FONT_SANS,
  },
};

const INJECTED_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
  @keyframes liveness-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes liveness-pulse {
    0%, 100% { transform: translate(-50%, -52%) scale(1); }
    50% { transform: translate(-50%, -52%) scale(1.03); }
  }
  @keyframes liveness-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
`;

export interface LivenessCheckProps {
  /**
   * Called when the session ends (pass or fail).
   * @param passed   true if all challenges completed in time
   * @param results  per-challenge breakdown
   * @param frame    captured photo at moment of completion
   */
  onComplete?: (
    passed: boolean,
    results: ChallengeResult[],
    frame?: CapturedFrame,
  ) => void;
  /** Additional CSS class applied to the root container. */
  className?: string;
  /** Brand/semantic color overrides. */
  theme?: LivenessTheme;
  /** Per-region inline style overrides. */
  styles?: LivenessStyles;
  /**
   * Number of challenges to pick when using the default set.
   * @default 3
   */
  numberOfChallenge?: number;
  /** Override the pool challenges are drawn from. */
  challengePool?: Challenge[];
  /**
   * Product/brand name shown at the top left.
   * @default "Liveness"
   */
  brandLabel?: string;
  /**
   * Organization or location shown in the header pill (rendered uppercase).
   * @default "Secure"
   */
  orgLabel?: string;
  /** Person's name shown on the result screen, if provided. */
  employeeName?: string;
  /** Person's id shown on the result screen, if provided. */
  employeeId?: string;
  /** Called when "Cancel" is tapped mid-session. Defaults to resetting the session. */
  onCancel?: () => void;
  /** Called when the supervisor-fallback link is tapped after a failure. Hidden if omitted. */
  onFallback?: () => void;
}

export function LivenessCheck({
  onComplete,
  className,
  theme,
  styles: customStyles,
  numberOfChallenge = 3,
  challengePool,
  brandLabel = "Liveness",
  orgLabel = "Secure",
  employeeName,
  employeeId,
  onCancel,
  onFallback,
}: LivenessCheckProps) {
  const {
    videoRef,
    isCameraReady,
    error: cameraError,
    startCamera,
    stopCamera,
  } = useCamera();

  const themeVars = {
    "--live-primary": theme?.primary || "#6ee7c4",
    "--live-success": theme?.success || "#6ee7c4",
    "--live-danger": theme?.danger || "#ff8f73",
    "--live-warning": theme?.warning || "#ff8f73",
    "--live-bg": theme?.background || "#0c0e13",
    "--live-bg-deep": "#090a0e",
    "--live-surface": theme?.surface || "#12161a",
    "--live-text": theme?.text || "#f4f7f5",
    "--live-muted": "#8f9d97",
    "--live-border": theme?.border || "rgba(255, 255, 255, 0.08)",
    "--live-on-primary": "#06231b",
  } as React.CSSProperties;

  const audio = useLivenessAudio();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [status, setStatus] = useState<ChallengeStatus>("idle");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [challengePassed, setChallengePassed] = useState(false);
  const [instructionKey, setInstructionKey] = useState(0);
  const [completedAt, setCompletedAt] = useState<Date | null>(null);

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
      if (!challenge) {
        // Nothing to advance past — release the lock so the session can't wedge.
        advancingRef.current = false;
        return;
      }

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
            setCompletedAt(new Date());

            // Capture the frame while the video is still live. Useful on failure
            // too — it's evidence for fraud review.
            const frame = videoRef.current
              ? captureFrame(videoRef.current, {
                  format: "image/jpeg",
                  quality: 0.88,
                })
              : null;

            if (sessionPassed) {
              audio.announceComplete();
            } else {
              audio.announceFail();
            }

            onComplete?.(sessionPassed, allResults, frame ?? undefined);
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
    }: {
      blendshapes: BlendshapeMap;
      faceDetected: boolean;
      landmarks: { x: number; y: number; z: number }[];
    }) => {
      setFaceDetected(fd);

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
    const picked = pickChallenges(numberOfChallenge, challengePool);
    setChallenges(picked);
    challengesRef.current = picked;
    setResults([]);
    resultsRef.current = [];
    advancingRef.current = false;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setChallengePassed(false);
    setCompletedAt(null);
    setStatus("waiting");
    statusRef.current = "waiting";

    await startCamera();
  }, [startCamera, numberOfChallenge, challengePool]);

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
    setCompletedAt(null);
    setStatus("idle");
    statusRef.current = "idle";
    setFaceDetected(false);
  }, [stopDetection, stopCamera]);

  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    } else {
      handleReset();
    }
  }, [onCancel, handleReset]);

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

  // Progress ring: 0 while idle/waiting, live per-challenge progress while
  // detecting, full on success, and the PASSED fraction on failure — using the
  // attempted fraction instead would draw a full ring on a failed session.
  const ringProgress = isDone
    ? allPassed
      ? 1
      : challenges.length
        ? results.filter((r) => r.passed).length / challenges.length
        : 0
    : status === "detecting"
      ? progressPct / 100
      : 0;
  const ringColor = isFailed
    ? "var(--live-danger, #ff8f73)"
    : "var(--live-primary, #6ee7c4)";
  const ringOffset =
    RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ringProgress)));

  // The headline below the ring is the component's primary voice — it carries
  // the current instruction, mirroring the reference design.
  let headlineTitle = "Ready to verify";
  let headlineSubtitle = "Allow camera access to begin";
  if (status === "waiting") {
    headlineTitle = isCameraReady ? "Almost ready" : "Starting camera";
    headlineSubtitle = isCameraReady
      ? "Preparing face detection…"
      : "Waiting for camera permission…";
  } else if (status === "detecting" && currentChallenge) {
    headlineTitle = currentChallenge.instruction;
    headlineSubtitle = faceDetected
      ? `Step ${currentIndex + 1} of ${challenges.length}`
      : "Center your face inside the ring";
  } else if (isComplete) {
    headlineTitle = "You're verified";
    headlineSubtitle = `${results.length} challenge${results.length === 1 ? "" : "s"} completed`;
  } else if (isFailed) {
    headlineTitle = "Verification failed";
    headlineSubtitle = "Some challenges were not completed in time";
  }

  const mergedStyles = {
    root: { ...defaultStyles.root, ...customStyles?.root },
    header: { ...defaultStyles.header, ...customStyles?.header },
    titleGroup: { ...defaultStyles.titleGroup, ...customStyles?.titleGroup },
    statusDot: { ...defaultStyles.statusDot, ...customStyles?.statusDot },
    title: { ...defaultStyles.title, ...customStyles?.title },
    orgBadge: { ...defaultStyles.orgBadge, ...customStyles?.orgBadge },
    errorBanner: { ...defaultStyles.errorBanner, ...customStyles?.errorBanner },
    cameraShell: { ...defaultStyles.cameraShell, ...customStyles?.cameraShell },
    ringWrap: { ...defaultStyles.ringWrap, ...customStyles?.ringWrap },
    cameraFrame: { ...defaultStyles.cameraFrame, ...customStyles?.cameraFrame },
    video: { ...defaultStyles.video, ...customStyles?.video },
    faceGuide: { ...defaultStyles.faceGuide, ...customStyles?.faceGuide },
    liveBadge: { ...defaultStyles.liveBadge, ...customStyles?.liveBadge },
    feedLabel: { ...defaultStyles.feedLabel, ...customStyles?.feedLabel },
    centerOverlay: { ...defaultStyles.centerOverlay, ...customStyles?.centerOverlay },
    stateLabel: { ...defaultStyles.stateLabel, ...customStyles?.stateLabel },
    headline: { ...defaultStyles.headline, ...customStyles?.headline },
    headlineTitle: { ...defaultStyles.headlineTitle, ...customStyles?.headlineTitle },
    headlineSubtitle: { ...defaultStyles.headlineSubtitle, ...customStyles?.headlineSubtitle },
    stepIndicator: { ...defaultStyles.stepIndicator, ...customStyles?.stepIndicator },
    stepDot: { ...defaultStyles.stepDot, ...customStyles?.stepDot },
    stepDotActive: { ...defaultStyles.stepDotActive, ...customStyles?.stepDotActive },
    stepCounter: { ...defaultStyles.stepCounter, ...customStyles?.stepCounter },
    cuePill: { ...defaultStyles.cuePill, ...customStyles?.cuePill },
    cueDot: { ...defaultStyles.cueDot, ...customStyles?.cueDot },
    cueText: { ...defaultStyles.cueText, ...customStyles?.cueText },
    identityRow: { ...defaultStyles.identityRow, ...customStyles?.identityRow },
    actionWrapper: { ...defaultStyles.actionWrapper, ...customStyles?.actionWrapper },
    actionButton: { ...defaultStyles.actionButton, ...customStyles?.actionButton },
    cancelLink: { ...defaultStyles.cancelLink, ...customStyles?.cancelLink },
    fallbackLink: { ...defaultStyles.fallbackLink, ...customStyles?.fallbackLink },
  };

  // Success only: the row is styled in the accent colour, which reads as a
  // pass — showing it under a failed check is contradictory.
  const showIdentityRow =
    isComplete && (employeeName || employeeId || completedAt);
  const showVideo = isCameraReady && !isDone;

  return (
    <div className={className} style={{ ...themeVars, ...mergedStyles.root }}>
      <style>{INJECTED_STYLES}</style>

      {/* Header — brand on the left, organization pill on the right */}
      <header style={mergedStyles.header}>
        <div style={mergedStyles.titleGroup}>
          <span
            style={{
              ...mergedStyles.statusDot,
              ...(isFailed
                ? {
                    background: "var(--live-danger, #ff8f73)",
                    boxShadow: "0 0 12px var(--live-danger, #ff8f73)",
                  }
                : {}),
            }}
          />
          <h3 style={mergedStyles.title}>{brandLabel}</h3>
        </div>

        <div style={mergedStyles.orgBadge}>{orgLabel}</div>
      </header>

      {/* Errors */}
      {(cameraError || modelError) && (
        <div style={mergedStyles.errorBanner}>
          <CircleAlert size={16} style={{ flex: "none" }} />
          <span>{cameraError || modelError}</span>
        </div>
      )}

      {/* Camera circle inside the progress ring */}
      <section style={mergedStyles.cameraShell}>
        <div style={mergedStyles.ringWrap}>
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            style={{
              position: "absolute",
              inset: 0,
              maxWidth: "100%",
              transform: "rotate(-90deg)",
            }}
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="var(--live-border, rgba(255, 255, 255, 0.08))"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
              style={{
                transition: "stroke-dashoffset 0.1s linear, stroke 0.3s ease",
              }}
            />
          </svg>

          <div style={mergedStyles.cameraFrame}>
            <video
              ref={videoRef}
              width={VIDEO_W}
              height={VIDEO_H}
              style={{
                ...mergedStyles.video,
                visibility: showVideo ? "visible" : "hidden",
              }}
              playsInline
              muted
            />

            {/* Face guide + live badge, while the camera is actually running */}
            {showVideo && (
              <>
                <div
                  style={{
                    ...mergedStyles.faceGuide,
                    ...(faceDetected
                      ? {
                          borderColor: "var(--live-success, #6ee7c4)",
                          animation: "liveness-pulse 1.5s infinite",
                        }
                      : {}),
                    ...(challengePassed
                      ? {
                          borderColor: "var(--live-success, #6ee7c4)",
                          backgroundColor:
                            "color-mix(in srgb, var(--live-success, #6ee7c4) 15%, transparent)",
                        }
                      : {}),
                  }}
                />
                <div style={mergedStyles.liveBadge}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--live-danger, #ff8f73)",
                      animation: "liveness-blink 1.4s infinite",
                    }}
                  />
                  LIVE
                </div>
              </>
            )}

            {/* Idle */}
            {status === "idle" && (
              <div style={mergedStyles.centerOverlay}>
                <Camera size={44} strokeWidth={1.5} />
                <span
                  style={{
                    ...mergedStyles.stateLabel,
                    color: "rgba(255, 255, 255, 0.32)",
                  }}
                >
                  CAMERA OFF
                </span>
              </div>
            )}

            {/* Waiting */}
            {status === "waiting" && (
              <div style={mergedStyles.centerOverlay}>
                <LoaderCircle
                  size={40}
                  strokeWidth={1.5}
                  style={{ animation: "liveness-spin 1s linear infinite" }}
                />
              </div>
            )}

            {/* Result */}
            {isDone && (
              <div style={mergedStyles.centerOverlay}>
                {allPassed ? (
                  <svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true">
                    <circle
                      cx="48"
                      cy="48"
                      r="43"
                      fill="none"
                      stroke="var(--live-success, #6ee7c4)"
                      strokeWidth="4"
                    />
                    <path
                      d="M31 49 L43 61 L66 34"
                      fill="none"
                      stroke="var(--live-success, #6ee7c4)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="80" height="80" viewBox="0 0 86 86" aria-hidden="true">
                    <circle
                      cx="43"
                      cy="43"
                      r="38"
                      fill="none"
                      stroke="var(--live-danger, #ff8f73)"
                      strokeWidth="4.5"
                    />
                    <line
                      x1="43"
                      y1="26"
                      x2="43"
                      y2="48"
                      stroke="var(--live-danger, #ff8f73)"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    <circle cx="43" cy="60" r="3.4" fill="var(--live-danger, #ff8f73)" />
                  </svg>
                )}
                <span
                  style={{
                    ...mergedStyles.stateLabel,
                    color: allPassed
                      ? "color-mix(in srgb, var(--live-success, #6ee7c4) 75%, transparent)"
                      : "color-mix(in srgb, var(--live-danger, #ff8f73) 75%, transparent)",
                  }}
                >
                  {allPassed ? "VERIFIED" : "NOT VERIFIED"}
                </span>
              </div>
            )}

            {/* Feed label, only while the live feed is showing */}
            {showVideo && <div style={mergedStyles.feedLabel}>CAMERA FEED</div>}
          </div>
        </div>
      </section>

      {/* Headline — the instruction lives below the ring, per the design */}
      <div style={mergedStyles.headline} key={instructionKey}>
        <div style={mergedStyles.headlineTitle}>{headlineTitle}</div>
        <p style={mergedStyles.headlineSubtitle}>{headlineSubtitle}</p>
      </div>

      {/* Step indicator */}
      {challenges.length > 0 && !isDone && (
        <div style={mergedStyles.stepIndicator}>
          {challenges.map((challenge, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            const res = results[i];

            return (
              <span
                key={`${challenge.type}-${i}`}
                style={{
                  ...mergedStyles.stepDot,
                  ...(active ? mergedStyles.stepDotActive : {}),
                  ...(done && res?.passed
                    ? { background: "var(--live-success, #6ee7c4)" }
                    : {}),
                  ...(done && res && !res.passed
                    ? { background: "var(--live-danger, #ff8f73)" }
                    : {}),
                }}
              />
            );
          })}
          <span style={mergedStyles.stepCounter}>
            {Math.min(currentIndex + 1, challenges.length)} / {challenges.length}
          </span>
        </div>
      )}

      {/* Cue pill */}
      {isActive && (
        <div style={mergedStyles.cuePill}>
          <span style={mergedStyles.cueDot} />
          <span style={mergedStyles.cueText}>Voice guidance on each step</span>
        </div>
      )}

      {/* Identity / timestamp row */}
      {showIdentityRow && (
        <div style={mergedStyles.identityRow}>
          {employeeName && (
            <span style={{ color: "var(--live-text, #e9f4ef)", fontWeight: 600 }}>
              {employeeName}
            </span>
          )}
          {employeeName && employeeId && (
            <span
              style={{
                width: 1,
                height: 14,
                background: "var(--live-border, rgba(255, 255, 255, 0.14))",
              }}
            />
          )}
          {employeeId && <span>{employeeId}</span>}
          {(employeeName || employeeId) && completedAt && (
            <span
              style={{
                width: 1,
                height: 14,
                background: "var(--live-border, rgba(255, 255, 255, 0.14))",
              }}
            />
          )}
          {completedAt && (
            <span>
              {completedAt.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}

      {/* Primary action */}
      {(status === "idle" || isDone) && (
        <div style={mergedStyles.actionWrapper}>
          <button
            type="button"
            style={mergedStyles.actionButton}
            onClick={status === "idle" ? handleStart : handleReset}
          >
            {status === "idle"
              ? "Start Verification"
              : allPassed
                ? "Done"
                : "Try again"}
          </button>
        </div>
      )}

      {/* Secondary actions */}
      {isActive && (
        <button type="button" style={mergedStyles.cancelLink} onClick={handleCancel}>
          Cancel
        </button>
      )}
      {isFailed && onFallback && (
        <button type="button" style={mergedStyles.fallbackLink} onClick={onFallback}>
          Verify with a supervisor instead
        </button>
      )}

      {/* Bottom spacing */}
      <div style={{ height: 30, flex: "none" }} />
    </div>
  );
}
