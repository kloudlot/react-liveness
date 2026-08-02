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
  Camera,
  LoaderCircle,
  AlertTriangle,
  CircleCheckBig,
  CircleX,
  ScanFace,
} from "lucide-react";

const VIDEO_W = 480;
const VIDEO_H = 360;
const RING_R = 46;
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
  subtitle?: React.CSSProperties;
  secureBadge?: React.CSSProperties;
  errorBanner?: React.CSSProperties;
  cameraShell?: React.CSSProperties;
  cameraFrame?: React.CSSProperties;
  video?: React.CSSProperties;
  faceGuide?: React.CSSProperties;
  liveBadge?: React.CSSProperties;
  idleOverlay?: React.CSSProperties;
  loadingOverlay?: React.CSSProperties;
  resultOverlay?: React.CSSProperties;
  warningPill?: React.CSSProperties;
  capturedThumb?: React.CSSProperties;
  stepIndicator?: React.CSSProperties;
  stepDot?: React.CSSProperties;
  stepDotActive?: React.CSSProperties;
  stepCounter?: React.CSSProperties;
  cuePill?: React.CSSProperties;
  cueDot?: React.CSSProperties;
  cueText?: React.CSSProperties;
  cancelLink?: React.CSSProperties;
  instructionCard?: React.CSSProperties;
  instructionIcon?: React.CSSProperties;
  instructionText?: React.CSSProperties;
  actionWrapper?: React.CSSProperties;
  actionButton?: React.CSSProperties;
  resultList?: React.CSSProperties;
  resultPill?: React.CSSProperties;
  identityRow?: React.CSSProperties;
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
      "radial-gradient(140% 90% at 50% -10%, color-mix(in srgb, var(--live-primary, #6ee7c4) 14%, var(--live-bg, #0c0e13)) 0%, var(--live-bg, #0c0e13) 55%, var(--live-bg-deep, #090a0e) 100%)",
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.08))",
    borderRadius: 32,
    overflow: "hidden",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
    fontFamily: FONT_SANS,
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
    gap: 10,
    alignItems: "center",
  },
  statusDot: {
    width: 10,
    height: 10,
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
    color: "var(--live-text, #f4f7f5)",
  },
  subtitle: {
    margin: 0,
    color: "var(--live-muted, #8f9d97)",
    fontSize: 12,
  },
  secureBadge: {
    display: "flex",
    alignItems: "center",
    fontFamily: FONT_MONO,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "var(--live-muted, #8a9a94)",
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.1))",
    padding: "5px 11px",
    borderRadius: 20,
    fontSize: 10,
  },
  errorBanner: {
    padding: "12px 20px",
    margin: "0 20px 16px",
    background: "color-mix(in srgb, var(--live-danger, #ff8f73) 12%, transparent)",
    border: "1px solid color-mix(in srgb, var(--live-danger, #ff8f73) 30%, transparent)",
    borderRadius: 12,
    color: "var(--live-danger, #ff8f73)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  },
  cameraShell: {
    padding: "8px 24px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraFrame: {
    position: "relative",
    width: 260,
    height: 260,
    borderRadius: "50%",
    background: "#05060a",
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
    top: "50%",
    left: "50%",
    width: 132,
    height: 168,
    borderRadius: "50% 50% 47% 47%",
    border: "1.6px dashed color-mix(in srgb, var(--live-primary, #6ee7c4) 55%, transparent)",
    transform: "translate(-50%, -52%)",
    transition: "border-color 0.3s ease",
  },
  liveBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FONT_MONO,
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: "0.14em",
    color: "rgba(255, 255, 255, 0.55)",
  },
  idleOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 12,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "0 24px",
    color: "var(--live-text, #f4f7f5)",
    background: "rgba(9, 10, 14, 0.55)",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 12,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--live-text, #f4f7f5)",
    background: "rgba(9, 10, 14, 0.55)",
  },
  warningPill: {
    position: "absolute",
    bottom: 14,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 999,
    background: "rgba(0, 0, 0, 0.7)",
    color: "white",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  resultOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    gap: 12,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    textAlign: "center",
    padding: "0 20px",
  },
  capturedThumb: {
    position: "absolute",
    bottom: 14,
    right: 14,
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: "hidden",
    border: "2px solid white",
  },
  stepIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    padding: "18px 20px 0",
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--live-border, rgba(255, 255, 255, 0.16))",
    transition: "all 0.2s",
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
    margin: "14px auto 0",
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
  cancelLink: {
    display: "block",
    textAlign: "center",
    margin: "14px auto 0",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--live-muted, #6c7c75)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: FONT_SANS,
  },
  instructionCard: {
    margin: "16px 20px 20px",
    padding: 18,
    borderRadius: 20,
    border: "1px solid var(--live-border, rgba(255, 255, 255, 0.08))",
    display: "flex",
    gap: 16,
    alignItems: "center",
    background: "rgba(255, 255, 255, 0.03)",
  },
  instructionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: "color-mix(in srgb, var(--live-primary, #6ee7c4) 12%, transparent)",
    display: "grid",
    placeItems: "center",
    color: "var(--live-primary, #6ee7c4)",
    flex: "none",
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
    background: "var(--live-primary, #6ee7c4)",
    color: "var(--live-on-primary, #06231b)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT_SANS,
    boxShadow: "0 12px 30px -10px color-mix(in srgb, var(--live-primary, #6ee7c4) 50%, transparent)",
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
  identityRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    background: "color-mix(in srgb, var(--live-primary, #6ee7c4) 8%, transparent)",
    border: "1px solid color-mix(in srgb, var(--live-primary, #6ee7c4) 20%, transparent)",
    padding: "12px 18px",
    borderRadius: 16,
    margin: "0 20px 16px",
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "var(--live-muted, #8fb8ad)",
  },
  fallbackLink: {
    display: "block",
    textAlign: "center",
    margin: "0 20px 20px",
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
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.03); }
  }
`;

export interface LivenessCheckProps {
  /**
   * Called when the session ends (pass or fail).
   * @param passed   true if all challenges completed in time
   * @param results  per-challenge breakdown
   * @param frame    captured photo at moment of completion (only when passed)
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
   * Text shown in the header badge (e.g. an organization or location name).
   * @default "Secure"
   */
  orgLabel?: string;
  /** Employee/user name shown on the success screen, if provided. */
  employeeName?: string;
  /** Employee/user id shown on the success screen, if provided. */
  employeeId?: string;
  /** Called when "Cancel" is tapped mid-session. Defaults to resetting the session. */
  onCancel?: () => void;
  /** Called when "Verify with a supervisor instead" is tapped after a failure. Hidden if omitted. */
  onFallback?: () => void;
}

export function LivenessCheck({
  onComplete,
  className,
  theme,
  styles: customStyles,
  numberOfChallenge = 3,
  challengePool,
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
    const picked = pickChallenges(numberOfChallenge, challengePool);
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
  // detecting, and a settled fraction on the done screens (full on success,
  // proportion-completed on failure — mirrors how far the session got).
  const ringProgress = isDone
    ? allPassed
      ? 1
      : challenges.length
        ? results.length / challenges.length
        : 0
    : status === "detecting"
      ? progressPct / 100
      : 0;
  const ringColor = isFailed
    ? "var(--live-danger, #ff8f73)"
    : "var(--live-primary, #6ee7c4)";
  const ringOffset = RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ringProgress)));

  // Compute merged styles
  const mergedStyles = {
    root: { ...defaultStyles.root, ...customStyles?.root },
    header: { ...defaultStyles.header, ...customStyles?.header },
    titleGroup: { ...defaultStyles.titleGroup, ...customStyles?.titleGroup },
    statusDot: { ...defaultStyles.statusDot, ...customStyles?.statusDot },
    title: { ...defaultStyles.title, ...customStyles?.title },
    subtitle: { ...defaultStyles.subtitle, ...customStyles?.subtitle },
    secureBadge: { ...defaultStyles.secureBadge, ...customStyles?.secureBadge },
    errorBanner: { ...defaultStyles.errorBanner, ...customStyles?.errorBanner },
    cameraShell: { ...defaultStyles.cameraShell, ...customStyles?.cameraShell },
    cameraFrame: { ...defaultStyles.cameraFrame, ...customStyles?.cameraFrame },
    video: { ...defaultStyles.video, ...customStyles?.video },
    faceGuide: { ...defaultStyles.faceGuide, ...customStyles?.faceGuide },
    liveBadge: { ...defaultStyles.liveBadge, ...customStyles?.liveBadge },
    idleOverlay: { ...defaultStyles.idleOverlay, ...customStyles?.idleOverlay },
    loadingOverlay: { ...defaultStyles.loadingOverlay, ...customStyles?.loadingOverlay },
    resultOverlay: { ...defaultStyles.resultOverlay, ...customStyles?.resultOverlay },
    warningPill: { ...defaultStyles.warningPill, ...customStyles?.warningPill },
    capturedThumb: { ...defaultStyles.capturedThumb, ...customStyles?.capturedThumb },
    stepIndicator: { ...defaultStyles.stepIndicator, ...customStyles?.stepIndicator },
    stepDot: { ...defaultStyles.stepDot, ...customStyles?.stepDot },
    stepDotActive: { ...defaultStyles.stepDotActive, ...customStyles?.stepDotActive },
    stepCounter: { ...defaultStyles.stepCounter, ...customStyles?.stepCounter },
    cuePill: { ...defaultStyles.cuePill, ...customStyles?.cuePill },
    cueDot: { ...defaultStyles.cueDot, ...customStyles?.cueDot },
    cueText: { ...defaultStyles.cueText, ...customStyles?.cueText },
    cancelLink: { ...defaultStyles.cancelLink, ...customStyles?.cancelLink },
    instructionCard: { ...defaultStyles.instructionCard, ...customStyles?.instructionCard },
    instructionIcon: { ...defaultStyles.instructionIcon, ...customStyles?.instructionIcon },
    instructionText: { ...defaultStyles.instructionText, ...customStyles?.instructionText },
    actionWrapper: { ...defaultStyles.actionWrapper, ...customStyles?.actionWrapper },
    actionButton: { ...defaultStyles.actionButton, ...customStyles?.actionButton },
    resultList: { ...defaultStyles.resultList, ...customStyles?.resultList },
    resultPill: { ...defaultStyles.resultPill, ...customStyles?.resultPill },
    identityRow: { ...defaultStyles.identityRow, ...customStyles?.identityRow },
    fallbackLink: { ...defaultStyles.fallbackLink, ...customStyles?.fallbackLink },
  };

  const showIdentityRow = isDone && (employeeName || employeeId);

  return (
    <div className={className} style={{ ...themeVars, ...mergedStyles.root }}>
      <style>{INJECTED_STYLES}</style>

      {/* Header */}
      <header style={mergedStyles.header}>
        <div style={mergedStyles.titleGroup}>
          <span style={mergedStyles.statusDot} />
          <div>
            <h3 style={mergedStyles.title}>Liveness Verification</h3>
            <p style={mergedStyles.subtitle}>Biometric identity confirmation</p>
          </div>
        </div>

        <div style={mergedStyles.secureBadge}>{orgLabel}</div>
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
          {/* Progress ring */}
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}
          >
            <circle
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              stroke="var(--live-border, rgba(255, 255, 255, 0.08))"
              strokeWidth="4"
            />
            <circle
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
              style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s ease" }}
            />
          </svg>

          {/* Video */}
          <video
            ref={videoRef}
            width={VIDEO_W}
            height={VIDEO_H}
            style={mergedStyles.video}
            playsInline
            muted
          />

          {/* Live badge */}
          {isCameraReady && (isActive || isDone) && (
            <div style={mergedStyles.liveBadge}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--live-danger, #ff8f73)",
                }}
              />
              LIVE
            </div>
          )}

          {/* Face guide */}
          {(isActive || isDone) && (
            <div
              style={{
                ...mergedStyles.faceGuide,
                ...(faceDetected ? { borderColor: "var(--live-success, #6ee7c4)", animation: "liveness-pulse 1.5s infinite" } : {}),
                ...(challengePassed ? { borderColor: "var(--live-success, #6ee7c4)", backgroundColor: "color-mix(in srgb, var(--live-success, #6ee7c4) 15%, transparent)" } : {}),
              }}
            />
          )}

          {/* Idle overlay */}
          {status === "idle" && (
            <div style={mergedStyles.idleOverlay}>
              <Camera size={44} />
              <h3 style={{ margin: 0, fontSize: 17 }}>Camera Required</h3>
              <p style={{ margin: 0, opacity: 0.8, fontSize: 13 }}>Allow camera access to start verification</p>
            </div>
          )}

          {/* Loading overlay */}
          {status === "waiting" && (
            <div style={mergedStyles.loadingOverlay}>
              <LoaderCircle size={40} style={{ animation: "liveness-spin 1s linear infinite" }} />
              <p style={{ margin: 0, fontSize: 13 }}>
                {!isCameraReady
                  ? "Starting camera..."
                  : "Preparing face detection..."}
              </p>
            </div>
          )}

          {/* Warning */}
          {status === "detecting" && !faceDetected && (
            <div style={mergedStyles.warningPill}>
              <AlertTriangle size={14} color="var(--live-warning, #ff8f73)" />
              Center your face in the frame
            </div>
          )}

          {/* Success / Fail Overlay */}
          {isDone && (
            <div style={{ ...mergedStyles.resultOverlay, background: allPassed ? "rgba(6, 35, 27, 0.82)" : "rgba(58, 26, 20, 0.82)" }}>
              {allPassed ? <CircleCheckBig size={64} color="var(--live-success, #6ee7c4)" /> : <CircleX size={64} color="var(--live-danger, #ff8f73)" />}

              <h2 style={{ margin: 0, fontSize: 19 }}>
                {allPassed ? "You're verified" : "Verification Failed"}
              </h2>

              <p style={{ margin: 0, opacity: 0.9, fontSize: 13 }}>
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

      {/* Step indicator */}
      {challenges.length > 0 && !isDone && (
        <div style={mergedStyles.stepIndicator}>
          {challenges.map((challenge, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            const res = results[i];
            const failedStep = done && res && !res.passed;

            return (
              <span
                key={challenge.type + i}
                style={{
                  ...mergedStyles.stepDot,
                  ...(active ? mergedStyles.stepDotActive : {}),
                  ...(failedStep ? { background: "var(--live-danger, #ff8f73)" } : {}),
                  ...(done && res?.passed ? { background: "var(--live-success, #6ee7c4)" } : {}),
                }}
              />
            );
          })}
          <span style={mergedStyles.stepCounter}>
            {Math.min(currentIndex + 1, challenges.length)} / {challenges.length}
          </span>
        </div>
      )}

      {/* Instruction Card */}
      {isActive && currentChallenge && status === "detecting" && (
        <div style={mergedStyles.instructionCard} key={instructionKey}>
          <div style={mergedStyles.instructionIcon}>
            <ScanFace size={22} />
          </div>

          <div style={mergedStyles.instructionText}>
            <h4 style={{ margin: 0, fontSize: 15, color: "var(--live-text, #f4f7f5)" }}>{currentChallenge.instruction}</h4>
            <p style={{ margin: 0, fontSize: 12, color: "var(--live-muted, #93a19b)" }}>
              Step {currentIndex + 1} of {challenges.length}
            </p>
          </div>
        </div>
      )}

      {/* Cue pill + cancel (active session) */}
      {isActive && (
        <>
          <div style={mergedStyles.cuePill}>
            <span style={mergedStyles.cueDot} />
            <span style={mergedStyles.cueText}>Voice guidance on each step</span>
          </div>
          <button type="button" style={mergedStyles.cancelLink} onClick={handleCancel}>
            Cancel
          </button>
        </>
      )}

      {/* Identity row (done screens, only if identity provided) */}
      {showIdentityRow && (
        <div style={mergedStyles.identityRow}>
          {employeeName && <span>{employeeName}</span>}
          {employeeName && employeeId && <span style={{ width: 1, height: 14, background: "var(--live-border)" }} />}
          {employeeId && <span>{employeeId}</span>}
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

      {/* Supervisor fallback (failure only) */}
      {isFailed && onFallback && (
        <button type="button" style={mergedStyles.fallbackLink} onClick={onFallback}>
          Verify with a supervisor instead
        </button>
      )}

      {/* Challenge Result Summary */}
      {isDone && (
        <div style={mergedStyles.resultList}>
          {results.map((result, idx) => (
            <div
              key={idx}
              style={{
                ...mergedStyles.resultPill,
                background: result.passed ? "color-mix(in srgb, var(--live-success, #6ee7c4) 12%, transparent)" : "color-mix(in srgb, var(--live-danger, #ff8f73) 12%, transparent)",
                color: result.passed ? "var(--live-success, #6ee7c4)" : "var(--live-danger, #ff8f73)",
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
