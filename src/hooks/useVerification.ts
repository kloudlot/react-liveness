'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapturedFrame, ChallengeResult } from '../types';

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Why a backend rejected a submission. Open-ended — these are the cases the
 * component can act on, and any other string is treated as a plain rejection.
 */
export type RejectionReason =
  /** The face did not match the enrolled identity. */
  | 'no_match'
  /** The photo itself was unusable. Retryable with a new photo alone. */
  | 'low_quality'
  /** Already checked in / submission seen before. */
  | 'duplicate'
  /** A business rule refused it. Not retryable by default. */
  | 'policy'
  | (string & {});

export type VerificationVerdict =
  | { status: 'verified'; data?: unknown }
  | {
      status: 'rejected';
      reason: RejectionReason;
      message?: string;
      /** @default true, except for `policy` */
      retryable?: boolean;
    }
  /** The backend could not be reached. Never counts against the attempt limit. */
  | { status: 'error'; message?: string };

export interface VerificationPayload {
  /**
   * Stable id for this liveness session, regenerated on a full restart but kept
   * across capture-only retries. Send it to the backend: it is the key
   * server-side rate limiting and deduplication should be built on.
   */
  sessionId: string;
  results: ChallengeResult[];
  /** The gated frontal capture. */
  frame: CapturedFrame;
  /** The pre-challenge framing frame, when the align phase ran. */
  alignFrame?: CapturedFrame;
  /** 1-based; counts rejections only, never transport errors. */
  attempt: number;
  startedAt: Date;
  completedAt: Date;
}

export interface VerifyContext {
  /** Aborted on cancel, unmount, or verify timeout. Pass to fetch. */
  signal: AbortSignal;
  /** Update the label shown to the user, e.g. "Uploading…" → "Comparing face…". */
  setStage: (label: string) => void;
}

export type VerificationState = 'idle' | 'verifying' | 'verified' | 'rejected' | 'error';

/**
 * What a retry would have to redo.
 *
 *   `resubmit` — same photo, ask again (transport failure)
 *   `capture`  — new photo, same liveness proof (unusable image)
 *   `session`  — everything (the backend judged the person, not the photo)
 *   `none`     — nothing further to try
 */
export type RetryScope = 'none' | 'resubmit' | 'capture' | 'session';

export interface UseVerificationOptions {
  onVerify?: (
    payload: VerificationPayload,
    ctx: VerifyContext,
  ) => Promise<VerificationVerdict>;
  /**
   * Rejections allowed before the user is out of retries.
   *
   * This is a UX affordance, NOT a security control. An attacker submitting
   * faces in bulk calls the API directly and never renders this component.
   * Real rate limiting must be server-side, keyed on `payload.sessionId`.
   * @default 3
   */
  maxAttempts?: number;
  /** Abort the verify call after this long and report `error`. @default 30000 */
  timeoutMs?: number;
  /** Called once per terminal verdict. */
  onSettled?: (verdict: VerificationVerdict) => void;
}

export interface UseVerificationReturn {
  state: VerificationState;
  verdict: VerificationVerdict | null;
  /** Consumer-supplied progress label, live during `verifying`. */
  stage: string | null;
  attempt: number;
  attemptsExhausted: boolean;
  retryScope: RetryScope;
  submit: (payload: Omit<VerificationPayload, 'attempt'>) => void;
  reset: () => void;
  cancel: () => void;
}

function resolveRetryScope(
  verdict: VerificationVerdict | null,
  attempt: number,
  maxAttempts: number,
): RetryScope {
  if (!verdict || verdict.status === 'verified') return 'none';

  // A transport failure is not the user's fault and did not judge them — the
  // captured frame is still perfectly good, so only the request repeats.
  if (verdict.status === 'error') return 'resubmit';

  const retryable = verdict.retryable ?? verdict.reason !== 'policy';
  if (!retryable) return 'none';
  if (attempt >= maxAttempts) return 'none';

  // An unusable photo is the one rejection a new photo alone can fix; every
  // other rejection is a judgement about the person, which a fresh photo of the
  // same person would not change.
  return verdict.reason === 'low_quality' ? 'capture' : 'session';
}

/**
 * Drives the backend verification call: attempt accounting, abort, timeout, and
 * turning a thrown error into an `error` verdict.
 *
 * The component owns this rather than the consumer because the failure modes —
 * a hung fetch, an unmount mid-request, a thrown exception — are exactly what
 * hand-rolled integrations get wrong.
 */
export function useVerification(options: UseVerificationOptions = {}): UseVerificationReturn {
  const { onVerify, maxAttempts = 3, timeoutMs = 30000, onSettled } = options;

  const [state, setState] = useState<VerificationState>('idle');
  const [verdict, setVerdict] = useState<VerificationVerdict | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOutRef = useRef(false);
  const cancelledRef = useRef(false);
  const runIdRef = useRef(0);

  const onVerifyRef = useRef(onVerify);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onVerifyRef.current = onVerify;
    onSettledRef.current = onSettled;
  }, [onVerify, onSettled]);

  const teardown = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    controllerRef.current = null;
  };

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    teardown();
    setStage(null);
    setState('idle');
  }, []);

  const reset = useCallback(() => {
    cancel();
    cancelledRef.current = false;
    setVerdict(null);
    setAttempt(0);
  }, [cancel]);

  const submit = useCallback(
    (payload: Omit<VerificationPayload, 'attempt'>) => {
      const verify = onVerifyRef.current;
      if (!verify) return;

      cancelledRef.current = false;
      timedOutRef.current = false;
      const runId = ++runIdRef.current;

      const controller = new AbortController();
      controllerRef.current = controller;

      timerRef.current = setTimeout(() => {
        timedOutRef.current = true;
        controller.abort();
      }, timeoutMs);

      setStage(null);
      setState('verifying');

      const attemptNo = attempt + 1;

      const settle = (v: VerificationVerdict, countsAsAttempt: boolean) => {
        // A late resolution from a superseded or cancelled run must not
        // overwrite the state of the run that replaced it.
        if (runId !== runIdRef.current || cancelledRef.current) return;
        teardown();
        setStage(null);
        setVerdict(v);
        setState(v.status === 'verified' ? 'verified' : v.status);
        if (countsAsAttempt) setAttempt(attemptNo);
        onSettledRef.current?.(v);
      };

      const ctx: VerifyContext = {
        signal: controller.signal,
        setStage: (label: string) => {
          if (runId === runIdRef.current) setStage(label);
        },
      };

      Promise.resolve()
        .then(() => verify({ ...payload, attempt: attemptNo }, ctx))
        .then((v) => settle(v, v.status === 'rejected'))
        .catch((err: unknown) => {
          if (cancelledRef.current && !timedOutRef.current) {
            teardown();
            return;
          }
          settle(
            {
              status: 'error',
              message: timedOutRef.current
                ? 'The check timed out. Please try again.'
                : err instanceof Error
                  ? err.message
                  : 'We could not reach the verification service.',
            },
            false,
          );
        });
    },
    [attempt, timeoutMs],
  );

  useEffect(
    () => () => {
      cancelledRef.current = true;
      controllerRef.current?.abort();
      teardown();
    },
    [],
  );

  return {
    state,
    verdict,
    stage,
    attempt,
    attemptsExhausted: attempt >= maxAttempts,
    retryScope: resolveRetryScope(verdict, attempt, maxAttempts),
    submit,
    reset,
    cancel,
  };
}
