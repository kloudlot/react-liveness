"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useCamera } from "../hooks/useCamera";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker";
import {
  CapturedFrame,
  Challenge,
  ChallengeResult,
  ChallengeStatus,
  FaceLandmarkerResult,
} from "../types";
import { useLivenessAudio } from "../hooks/useLivenessAudio";
import { pickChallenges } from "../challenges";
import { captureFrame } from "../utils/captureFrame";
import { useCenteredCapture } from "../hooks/useCenteredCapture";
import type { CaptureGates } from "../utils/captureGates";
import { useVerification } from "../hooks/useVerification";
import type {
  VerificationPayload,
  VerificationVerdict,
  VerifyContext,
} from "../hooks/useVerification";
import { Camera, LoaderCircle, CircleAlert } from "lucide-react";

// Read off globalThis rather than as a bare `process.env.NODE_ENV`: this package
// has no @types/node, and adding a dependency to gate one dev warning is not
// worth it. The cost is that bundlers cannot statically eliminate the warning,
// which is a few lines of shipped code.
const IS_PRODUCTION =
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV ===
  "production";

/** crypto.randomUUID is unavailable on http origins and older Safari. */
function newSessionId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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

// Opt-in, and off by default. An identity-verification widget should not make
// an unannounced request to a third party the moment it renders — it leaks that
// a verification is happening, and it hard-fails under the strict CSP that the
// deployments this package targets tend to run. The font stacks above already
// fall back to system fonts, so the component looks correct without it.
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');`;

const INJECTED_STYLES = `
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
  @media (prefers-reduced-motion: reduce) {
    [data-liveness-root] *,
    [data-liveness-root] *::before,
    [data-liveness-root] *::after {
      animation: none !important;
      transition-duration: 0.01ms !important;
    }
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
  /**
   * How the photo handed to `onComplete` is chosen.
   *
   *   `centeredFace` — run a frontal capture gate after the challenges and hand
   *     back the best frontal, eyes-open, in-focus frame.
   *   `onComplete` — legacy behaviour: grab whatever frame is live the instant
   *     the last challenge resolves. That frame is systematically the worst of
   *     the session (a TURN finish yields a profile; a BLINK finish yields
   *     closed eyes), so it is unsuitable for backend face comparison.
   *   `off` — capture nothing.
   *
   * @default 'centeredFace'
   */
  captureMode?: "centeredFace" | "onComplete" | "off";
  /** Threshold overrides for the capture gate, merged over the calibrated defaults. */
  captureGates?: Partial<CaptureGates>;
  /** How long every gate must hold before capturing. @default 600 */
  captureHoldMs?: number;
  /** Give up on the capture gate after this long, keeping the best frame seen. @default 8000 */
  captureTimeoutMs?: number;
  /** Crop the captured image to the face box. @default false */
  cropToFace?: boolean;
  /**
   * Run a short framing step before the challenges. Establishes the per-device
   * pitch baseline (camera height offsets pitch by a constant that differs
   * between a laptop and a phone) and yields a second frontal frame the backend
   * can use as a same-person continuity check.
   * @default true
   */
  alignPhase?: boolean;
  /**
   * Fail the session if face tracking drops for longer than
   * `maxTrackingGapMs` during the capture phase. Without this, the window
   * between "challenges passed" and "photo taken" is a swap opportunity: pass
   * the challenges live, then present a photo of someone else.
   * @default true
   */
  continuityGuard?: boolean;
  /** @default 1200 */
  maxTrackingGapMs?: number;
  /** Called with the gated capture, before `onComplete`. */
  onCapture?: (frame: CapturedFrame) => void;
  /** Called with the pre-challenge framing frame, when `alignPhase` is on. */
  onAlignCapture?: (frame: CapturedFrame) => void;
  /**
   * Submit the capture to your backend and return its verdict.
   *
   * Passing liveness is not the same as being verified: only your backend can
   * say whether this face matches the enrolled identity. When this is provided,
   * the session shows "verified" only after it returns `{ status: 'verified' }`.
   * When omitted, behaviour is unchanged — liveness pass is the final answer.
   *
   * Throwing (or rejecting) is reported as `{ status: 'error' }`, which never
   * counts against `maxAttempts`. For a polling backend, poll inside this
   * function and call `ctx.setStage()` as it progresses.
   */
  onVerify?: (
    payload: VerificationPayload,
    ctx: VerifyContext,
  ) => Promise<VerificationVerdict>;
  /**
   * Rejections allowed before retries stop. UX only — see the note on
   * UseVerificationOptions.maxAttempts; real limits must be server-side.
   * @default 3
   */
  maxAttempts?: number;
  /** Abort the verify call after this long. @default 30000 */
  verifyTimeoutMs?: number;
  /**
   * Capture-only retries allowed per liveness proof, when the backend rejects
   * with `low_quality`. Capped because each one yields another photo off a
   * single liveness proof.
   * @default 1
   */
  maxCaptureRetries?: number;
  /** Called once per terminal backend verdict. */
  onSettled?: (verdict: VerificationVerdict) => void;
  /**
   * Load Space Grotesk / Space Mono from Google Fonts at render time.
   *
   * Off by default: it is an unannounced third-party request from an identity
   * widget, and it fails outright under a strict CSP. The component falls back
   * to the system font stack, which is what most deployments should use. Self-
   * host the fonts if you want the exact reference look under CSP.
   * @default false
   */
  loadFonts?: boolean;
  /** Accessible name for the widget. @default "Liveness verification" */
  ariaLabel?: string;
}

// During alignment the user is only being asked to position themselves, so
// expression and blink gates are irrelevant — and pitch cannot be gated tightly
// yet because the baseline it would be measured against is what this phase
// exists to establish.
const ALIGN_GATE_OVERRIDES: Partial<CaptureGates> = {
  maxPitchDeg: 30,
  maxEyeBlink: 1,
  maxJawOpen: 1,
  maxSmile: 1,
};

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
  captureMode = "centeredFace",
  captureGates,
  captureHoldMs = 600,
  captureTimeoutMs = 8000,
  cropToFace = false,
  alignPhase = true,
  continuityGuard = true,
  maxTrackingGapMs = 1200,
  onCapture,
  onAlignCapture,
  onVerify,
  maxAttempts = 3,
  verifyTimeoutMs = 30000,
  maxCaptureRetries = 1,
  onSettled,
  loadFonts = false,
  ariaLabel = "Liveness verification",
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
  // The inter-challenge pause in advanceChallenge must be cancellable: it calls
  // onComplete and setState after firing, so an uncancelled pending timeout
  // advances a session the user already cancelled, and setStates a component
  // that may already be unmounted.
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const challengeStartRef = useRef<number>(0);
  const currentIndexRef = useRef(0);
  const statusRef = useRef<ChallengeStatus>("idle");
  const challengesRef = useRef<Challenge[]>([]);
  const resultsRef = useRef<ChallengeResult[]>([]);
  const advancingRef = useRef(false);

  // Capture-phase state
  const [pitchBaselineDeg, setPitchBaselineDeg] = useState<number | undefined>(undefined);
  const finalisedRef = useRef(false);
  const continuityBrokenRef = useRef(false);
  const lastFaceSeenRef = useRef(0);
  const captureModeRef = useRef(captureMode);
  captureModeRef.current = captureMode;

  const align = useCenteredCapture(videoRef, {
    gates: { ...captureGates, ...ALIGN_GATE_OVERRIDES },
    holdMs: 400,
    timeoutMs: 10000,
    mirror: false,
    format: "image/jpeg",
    encodeQuality: 0.9,
  });

  // Session identity and the artefacts a retry needs. Kept in refs because they
  // are read from timers and effect callbacks that would otherwise close over a
  // stale render.
  const sessionIdRef = useRef<string>("");
  const sessionStartRef = useRef<Date | null>(null);
  const alignFrameRef = useRef<CapturedFrame | undefined>(undefined);
  const captureFrameRef = useRef<CapturedFrame | undefined>(undefined);
  const captureRetriesRef = useRef(0);
  /** Set when the capture phase ended with no usable frame at all. */
  const captureFailedRef = useRef(false);

  const verification = useVerification({
    onVerify,
    maxAttempts,
    timeoutMs: verifyTimeoutMs,
    onSettled,
  });

  const capture = useCenteredCapture(videoRef, {
    gates: captureGates,
    holdMs: captureHoldMs,
    timeoutMs: captureTimeoutMs,
    mirror: false,
    cropToFace,
    format: "image/jpeg",
    encodeQuality: 0.9,
    pitchBaselineDeg,
  });

  // Referenced from timers and RAF callbacks, which would otherwise close over
  // a stale render. The rest of this component already uses this pattern.
  const phaseCtl = useRef({ startCapture: capture.start, cancelAll: () => {} });
  useEffect(() => {
    phaseCtl.current = {
      startCapture: capture.start,
      cancelAll: () => {
        align.cancel();
        capture.cancel();
      },
    };
  }, [capture.start, capture.cancel, align.cancel]);

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

  const clearPendingAdvance = () => {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
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
      clearPendingAdvance();

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

      advanceTimeoutRef.current = setTimeout(
        () => {
          advanceTimeoutRef.current = null;
          const nextIdx = idx + 1;

          if (nextIdx >= challengesRef.current.length) {
            // Challenges done — derive pass/fail from the full authoritative list
            const sessionPassed = allResults.every((r) => r.passed);

            // Liveness passed: hand off to the frontal capture gate rather than
            // grabbing whatever pose the last challenge left the user in.
            if (sessionPassed && captureModeRef.current === "centeredFace") {
              setStatus("capturing");
              statusRef.current = "capturing";
              // Continuity is only tracked from here on. Watching it during the
              // challenges would false-positive constantly, since TURN
              // challenges legitimately rotate the face out of detection.
              lastFaceSeenRef.current = Date.now();
              continuityBrokenRef.current = false;
              audio.announceChallenge("Look straight at the camera");
              phaseCtl.current.startCapture();
              return;
            }

            setStatus(sessionPassed ? "complete" : "failed");
            statusRef.current = sessionPassed ? "complete" : "failed";
            setCompletedAt(new Date());

            // Capture the frame while the video is still live. Useful on failure
            // too — it's evidence for fraud review.
            const frame =
              videoRef.current && captureModeRef.current !== "off"
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

            finalisedRef.current = true;
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
    (result: FaceLandmarkerResult) => {
      const { blendshapes, faceDetected: fd } = result;
      setFaceDetected(fd);

      const phase = statusRef.current;

      if (phase === "aligning") {
        align.submit(result);
        return;
      }

      if (phase === "capturing") {
        // Swap guard: the face must remain continuously tracked from the end of
        // the challenges through to the photo.
        const now = Date.now();
        if (fd) {
          lastFaceSeenRef.current = now;
        } else if (now - lastFaceSeenRef.current > maxTrackingGapMs) {
          continuityBrokenRef.current = true;
        }
        capture.submit(result);
        return;
      }

      if (phase !== "detecting") return;

      const idx = currentIndexRef.current;
      const challenge = challengesRef.current[idx];
      if (!challenge || !fd) return;

      const allMatch = challenge.blendshapes.every(({ key, threshold, compare }) => {
        const score = blendshapes[key] ?? 0;
        // Default infers direction from the threshold's sign, which is the
        // original behaviour (e.g. TURN_RIGHT headYaw uses a negative threshold
        // to mean "below"). Band comparisons must be explicit — the inference
        // cannot represent them.
        const mode = compare ?? (threshold < 0 ? "below" : "above");
        switch (mode) {
          case "below":
            return score < threshold;
          case "absBelow":
            return Math.abs(score) < Math.abs(threshold);
          case "absAbove":
            return Math.abs(score) > Math.abs(threshold);
          default:
            return score > threshold;
        }
      });

      if (allMatch) {
        const elapsed = Date.now() - challengeStartRef.current;
        advanceChallenge(true, elapsed);
      }
    },
    [advanceChallenge, align.submit, capture.submit, maxTrackingGapMs],
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
    finalisedRef.current = false;
    continuityBrokenRef.current = false;
    captureRetriesRef.current = 0;
    captureFailedRef.current = false;
    alignFrameRef.current = undefined;
    captureFrameRef.current = undefined;
    sessionIdRef.current = newSessionId();
    sessionStartRef.current = new Date();
    verification.reset();
    setPitchBaselineDeg(undefined);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setChallengePassed(false);
    setCompletedAt(null);
    setStatus("waiting");
    statusRef.current = "waiting";

    await startCamera();
  }, [startCamera, numberOfChallenge, challengePool]);

  useEffect(() => {
    if (!(isCameraReady && !isModelLoading && status === "waiting")) return;

    startDetection();

    if (alignPhase && captureMode === "centeredFace") {
      setStatus("aligning");
      statusRef.current = "aligning";
      align.start();
    } else {
      startChallenge(0);
    }
  }, [
    isCameraReady,
    isModelLoading,
    status,
    startDetection,
    startChallenge,
    alignPhase,
    captureMode,
    align.start,
  ]);

  // Alignment settled — record the per-device pitch baseline and the framing
  // frame, then start the challenges. Alignment never blocks: if it times out
  // the session proceeds without a baseline and the pitch gate falls back to an
  // absolute check. Framing is not a liveness requirement.
  useEffect(() => {
    if (statusRef.current !== "aligning") return;
    if (align.state !== "captured" && align.state !== "timeout") return;

    const baseline = align.result?.quality?.pose?.pitchDeg;
    if (baseline !== undefined) setPitchBaselineDeg(baseline);
    if (align.result) {
      alignFrameRef.current = align.result;
      onAlignCapture?.(align.result);
    }

    setStatus("detecting");
    statusRef.current = "detecting";
    startChallenge(0);
  }, [align.state, align.result, onAlignCapture, startChallenge]);

  // Capture settled — this is the session's real terminal transition.
  useEffect(() => {
    if (statusRef.current !== "capturing") return;
    if (capture.state !== "captured" && capture.state !== "timeout") return;
    if (finalisedRef.current) return;
    finalisedRef.current = true;

    const frame = capture.result ?? undefined;
    const swapped = continuityGuard && continuityBrokenRef.current;

    setCompletedAt(new Date());

    if (swapped) {
      setStatus("failed");
      statusRef.current = "failed";
      audio.announceFail();
      onComplete?.(false, resultsRef.current, frame);
      return;
    }

    // No frame at all means the video produced no pixels — even the ungated
    // fallback in useCenteredCapture could not draw. There is nothing to submit
    // and nothing to review, so this cannot be reported as a pass. Previously
    // this path fell through to "complete", so a session with no photo and no
    // backend check displayed "You're verified".
    if (!frame) {
      captureFailedRef.current = true;
      setStatus("failed");
      statusRef.current = "failed";
      audio.announceFail();
      onComplete?.(false, resultsRef.current, undefined);
      return;
    }

    captureFrameRef.current = frame;
    onCapture?.(frame);

    if (!IS_PRODUCTION && frame.quality && !frame.quality.passedGates) {
      console.warn(
        "[LivenessCheck] The capture gate timed out without a frame passing every " +
          "check, so an ungated best-effort frame was used (quality.passedGates " +
          "is false). Failing gates: " +
          (frame.quality.failures.map((f) => f.gate).join(", ") || "unknown") +
          ". Gate defaults are calibrated per camera — run `npm run calibrate` on " +
          "this device, or widen `captureGates`.",
      );
    }

    // onComplete has always meant "the liveness stage resolved", and still does.
    // The backend verdict is reported separately via onSettled, so adding
    // verification does not change this callback's contract.
    onComplete?.(true, resultsRef.current, frame);

    // Runs whenever a frame exists, gated or not. Withholding an unusable photo
    // from the backend would silently skip verification entirely — the backend
    // is better placed to judge it, and `frame.quality.passedGates` tells it how
    // much to trust what it received.
    if (onVerify) {
      setStatus("verifying");
      statusRef.current = "verifying";
      verification.submit({
        sessionId: sessionIdRef.current,
        results: resultsRef.current,
        frame,
        alignFrame: alignFrameRef.current,
        startedAt: sessionStartRef.current ?? new Date(),
        completedAt: new Date(),
      });
      return;
    }

    setStatus("complete");
    statusRef.current = "complete";
    audio.announceComplete();
  }, [
    capture.state,
    capture.result,
    continuityGuard,
    onCapture,
    onComplete,
    onVerify,
    verification.submit,
  ]);

  // Backend verdict settled — the session's true terminal transition when
  // onVerify is supplied.
  useEffect(() => {
    if (statusRef.current !== "verifying") return;

    const next =
      verification.state === "verified"
        ? "complete"
        : verification.state === "rejected"
          ? "rejected"
          : verification.state === "error"
            ? "error"
            : null;
    if (!next) return;

    setStatus(next);
    statusRef.current = next;
    setCompletedAt(new Date());

    if (next === "complete") audio.announceComplete();
    else audio.announceFail();
  }, [verification.state]);

  const handleReset = useCallback(() => {
    clearTimer();
    clearPendingAdvance();
    advancingRef.current = false;
    finalisedRef.current = false;
    continuityBrokenRef.current = false;
    captureRetriesRef.current = 0;
    captureFailedRef.current = false;
    alignFrameRef.current = undefined;
    captureFrameRef.current = undefined;
    setPitchBaselineDeg(undefined);
    phaseCtl.current.cancelAll();
    verification.reset();
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

  // Retake the photo without re-running the challenges. Only reachable after a
  // `low_quality` rejection, and capped by maxCaptureRetries — each one yields
  // another photo off a single liveness proof.
  //
  // This depends on the camera and face tracking having stayed live through the
  // backend call. Releasing them and restarting would break the continuity
  // chain, turning the retry into exactly the swap window the guard exists to
  // close, so the camera is deliberately NOT stopped during `verifying`.
  const handleRetakePhoto = useCallback(() => {
    if (captureRetriesRef.current >= maxCaptureRetries) return;
    captureRetriesRef.current += 1;

    finalisedRef.current = false;
    continuityBrokenRef.current = false;
    lastFaceSeenRef.current = Date.now();
    verification.reset();

    setStatus("capturing");
    statusRef.current = "capturing";
    audio.announceChallenge("Look straight at the camera");
    phaseCtl.current.startCapture();
  }, [maxCaptureRetries, verification.reset]);

  /** Resubmit the same frame after a transport failure. */
  const handleResubmit = useCallback(() => {
    const frame = captureFrameRef.current;
    if (!frame) return;

    setStatus("verifying");
    statusRef.current = "verifying";
    verification.submit({
      sessionId: sessionIdRef.current,
      results: resultsRef.current,
      frame,
      alignFrame: alignFrameRef.current,
      startedAt: sessionStartRef.current ?? new Date(),
      completedAt: new Date(),
    });
  }, [verification.submit]);

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
      clearPendingAdvance();
      phaseCtl.current.cancelAll();
      stopDetection();
      audio.stop();
    },
    [stopDetection],
  );

  const isComplete = status === "complete";
  const isRejected = status === "rejected";
  const isError = status === "error";
  const isFailed = status === "failed" || isRejected || isError;
  const isDone = isComplete || isFailed;
  const isAligning = status === "aligning";
  const isCapturing = status === "capturing";
  const isActive =
    status === "detecting" || status === "waiting" || isAligning || isCapturing;
  const currentChallenge = challenges[currentIndex];
  // What the primary button should do on a terminal failure. The hook decides
  // the scope; the component additionally refuses a capture-only retry once
  // maxCaptureRetries is spent, so a single liveness proof cannot be milked for
  // an unbounded number of photos.
  const retryAction =
    verification.retryScope === "capture" && captureRetriesRef.current >= maxCaptureRetries
      ? "session"
      : verification.retryScope;

  // `failed` and `rejected` are the user's problem to fix; `error` is ours.
  // Painting a service outage in the same red as a rejected identity reads as
  // an accusation, and pushes people to retry something that is not their fault.
  const terminalTone: "success" | "danger" | "warning" = isComplete
    ? "success"
    : isError
      ? "warning"
      : "danger";
  const toneColor =
    terminalTone === "success"
      ? "var(--live-success, #6ee7c4)"
      : terminalTone === "warning"
        ? "var(--live-warning, #ff8f73)"
        : "var(--live-danger, #ff8f73)";

  const gatePhaseActive = isAligning || isCapturing;
  const gatesPassing = gatePhaseActive
    ? (isCapturing ? capture.evaluation : align.evaluation)?.passedGates === true
    : false;
  // Liveness verdict only. `isComplete` is the authority on the session outcome
  // now that the capture phase sits between the last challenge and the end.
  const allPassed = isComplete;
  const progressPct = currentChallenge
    ? ((currentChallenge.timeoutMs - timeRemaining) /
        currentChallenge.timeoutMs) * 100
    : 0;

  // Progress ring: 0 while idle/waiting, live per-challenge progress while
  // detecting, hold progress during the capture gate, full on success, and the
  // PASSED fraction on failure — using the attempted fraction instead would draw
  // a full ring on a failed session.
  const ringProgress = isDone
    ? allPassed
      ? 1
      : challenges.length
        ? results.filter((r) => r.passed).length / challenges.length
        : 0
    : isCapturing
      ? capture.holdProgress
      : isAligning
        ? align.holdProgress
        : status === "detecting"
          ? progressPct / 100
          : 0;
  const ringColor = isDone ? toneColor : "var(--live-primary, #6ee7c4)";
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
  } else if (isAligning) {
    headlineTitle = "Center your face";
    // The gate knows exactly which check is failing, so say that rather than
    // leaving the user to guess why nothing is happening.
    headlineSubtitle = align.nudge ?? "Hold still…";
  } else if (status === "detecting" && currentChallenge) {
    headlineTitle = currentChallenge.instruction;
    headlineSubtitle = faceDetected
      ? `Step ${currentIndex + 1} of ${challenges.length}`
      : "Center your face inside the ring";
  } else if (isCapturing) {
    headlineTitle = "Look straight at the camera";
    headlineSubtitle = capture.nudge ?? "Hold still — taking your photo";
  } else if (status === "verifying") {
    headlineTitle = "Checking…";
    // Consumer-supplied stage beats a generic label: a 20s wait with no
    // explanation reads as a hang.
    headlineSubtitle = verification.stage ?? "Confirming your identity";
  } else if (isComplete) {
    headlineTitle = "You're verified";
    headlineSubtitle = `${results.length} challenge${results.length === 1 ? "" : "s"} completed`;
  } else if (isRejected) {
    headlineTitle = "Not verified";
    headlineSubtitle =
      (verification.verdict?.status === "rejected" && verification.verdict.message) ||
      (verification.attemptsExhausted
        ? "No attempts remaining"
        : "We could not confirm your identity");
  } else if (isError) {
    headlineTitle = "Something went wrong";
    headlineSubtitle =
      (verification.verdict?.status === "error" && verification.verdict.message) ||
      "We could not complete the check. Please try again.";
  } else if (status === "failed") {
    headlineTitle = "Verification failed";
    headlineSubtitle = continuityBrokenRef.current
      ? "Face tracking was lost before the photo was taken"
      : captureFailedRef.current
        ? "We could not take a usable photo. Please try again."
        : "Some challenges were not completed in time";
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

  // Only on a true pass. The row is styled in the accent colour and names a
  // person, so it reads as "this is confirmed who they are" — which is a claim
  // only the backend can make. `isComplete` now means verified when onVerify is
  // supplied, so this gate is on the backend verdict rather than on liveness.
  const showIdentityRow =
    isComplete && (employeeName || employeeId || completedAt);

  // Without a backend there is nothing confirming the person is who the props
  // say they are — liveness proves a live human, never an identity.
  useEffect(() => {
    if (IS_PRODUCTION) return;
    if (!onVerify && (employeeName || employeeId)) {
      console.warn(
        "[LivenessCheck] employeeName/employeeId are displayed on success, but no " +
          "`onVerify` is set. Liveness proves a live person, not which person — " +
          "the component will name someone it has not verified. Pass `onVerify` " +
          "to check the capture against your records.",
      );
    }
  }, [onVerify, employeeName, employeeId]);
  const showVideo = isCameraReady && !isDone;

  return (
    <div
      className={className}
      style={{ ...themeVars, ...mergedStyles.root }}
      data-liveness-root=""
      data-liveness-status={status}
      role="region"
      aria-label={ariaLabel}
    >
      <style>{(loadFonts ? FONT_IMPORT : "") + INJECTED_STYLES}</style>

      {/* Header — brand on the left, organization pill on the right */}
      <header style={mergedStyles.header}>
        <div style={mergedStyles.titleGroup}>
          <span
            style={{
              ...mergedStyles.statusDot,
              ...(isDone
                ? { background: toneColor, boxShadow: `0 0 12px ${toneColor}` }
                : {}),
            }}
          />
          <h3 style={mergedStyles.title}>{brandLabel}</h3>
        </div>

        <div style={mergedStyles.orgBadge}>{orgLabel}</div>
      </header>

      {/* Errors */}
      {(cameraError || modelError) && (
        <div style={mergedStyles.errorBanner} role="alert">
          <CircleAlert size={16} style={{ flex: "none" }} aria-hidden="true" />
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
              aria-label="Camera preview"
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
                    // During the gated phases the guide tracks the gate itself:
                    // solid once every check passes, amber while something is
                    // still failing. Users cannot correct a failure they cannot
                    // see, and this is the difference between a first-try pass
                    // and a confused timeout.
                    ...(gatePhaseActive && !gatesPassing
                      ? {
                          borderStyle: "dashed",
                          borderColor: "var(--live-warning, #ff8f73)",
                          animation: "none",
                        }
                      : {}),
                    ...(challengePassed || (gatePhaseActive && gatesPassing)
                      ? {
                          borderStyle: "solid",
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
                <Camera size={44} strokeWidth={1.5} aria-hidden="true" />
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
                  aria-hidden="true"
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
                    <circle cx="43" cy="43" r="38" fill="none" stroke={toneColor} strokeWidth="4.5" />
                    <line
                      x1="43"
                      y1="26"
                      x2="43"
                      y2="48"
                      stroke={toneColor}
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    <circle cx="43" cy="60" r="3.4" fill={toneColor} />
                  </svg>
                )}
                <span
                  style={{
                    ...mergedStyles.stateLabel,
                    color: `color-mix(in srgb, ${toneColor} 75%, transparent)`,
                  }}
                >
                  {allPassed ? "VERIFIED" : isError ? "CHECK FAILED" : "NOT VERIFIED"}
                </span>
              </div>
            )}

            {/* Backend verdict in flight — the camera stays live behind this so
                a low_quality rejection can retake the photo without breaking
                the tracking-continuity chain. */}
            {status === "verifying" && (
              <div style={mergedStyles.centerOverlay}>
                <LoaderCircle
                  size={40}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ animation: "liveness-spin 1s linear infinite" }}
                />
                <span
                  style={{
                    ...mergedStyles.stateLabel,
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  CHECKING
                </span>
              </div>
            )}

            {/* Feed label, only while the live feed is showing */}
            {showVideo && <div style={mergedStyles.feedLabel}>CAMERA FEED</div>}
          </div>
        </div>
      </section>

      {/* Headline — the instruction lives below the ring, per the design.
          This is the component's entire spoken interface: every instruction,
          gate nudge and verdict passes through it, so it is the live region.
          Without this a screen-reader user gets a camera and silence. */}
      <div
        style={mergedStyles.headline}
        key={instructionKey}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
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

      {/* Primary action — the retry it offers matches what actually needs
          redoing. Sending someone through the full challenge sequence again to
          fix a blurry photo, or silently re-photographing them after the
          backend judged the person, would both be wrong. */}
      {(status === "idle" || isDone) && (
        <div style={mergedStyles.actionWrapper}>
          <button
            type="button"
            style={mergedStyles.actionButton}
            onClick={
              status === "idle"
                ? handleStart
                : retryAction === "capture"
                  ? handleRetakePhoto
                  : retryAction === "resubmit"
                    ? handleResubmit
                    : handleReset
            }
          >
            {status === "idle"
              ? "Start Verification"
              : allPassed
                ? "Done"
                : retryAction === "capture"
                  ? "Retake photo"
                  : retryAction === "resubmit"
                    ? "Try again"
                    : "Start over"}
          </button>
        </div>
      )}

      {/* Secondary actions */}
      {isActive && (
        <button type="button" style={mergedStyles.cancelLink} onClick={handleCancel}>
          Cancel
        </button>
      )}
      {/* A capture-only retry is still a full restart away from being exhausted,
          so the fallback is offered alongside it rather than instead of it. */}
      {isFailed && retryAction !== "session" && retryAction !== "none" && (
        <button type="button" style={mergedStyles.cancelLink} onClick={handleReset}>
          Start over instead
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
