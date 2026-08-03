'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceLandmarkerResult, HeadPose } from '../types';
import {
  DEFAULT_CAPTURE_GATES,
  type CaptureGates,
} from '../utils/captureGates';
import { evaluateGates, poseJitter } from '../utils/evaluateGates';
import { measureFrameQuality } from '../utils/frameQuality';
import {
  drawVideoFrame,
  frameFromCanvas,
  type CapturedFrame,
  type CaptureQuality,
} from '../utils/captureFrame';

export type CaptureState =
  /** Not running. */
  | 'idle'
  /** Running, but one or more gates are failing. */
  | 'searching'
  /** All gates passing; counting down the hold. */
  | 'holding'
  /** Finished with a gated frame. */
  | 'captured'
  /** Finished on timeout — see result.quality.passedGates. */
  | 'timeout';

export interface UseCenteredCaptureOptions {
  /** Threshold overrides, merged over DEFAULT_CAPTURE_GATES. */
  gates?: Partial<CaptureGates>;
  /**
   * How long every gate must hold continuously before capturing.
   * Rejects a good pose flashed through on the way to somewhere else.
   * @default 600
   */
  holdMs?: number;
  /**
   * Give up after this long and finish with the best frame seen.
   * @default 8000
   */
  timeoutMs?: number;
  /**
   * Mirror the captured image.
   * @default false — the canonical record for backend comparison should be
   * true camera orientation, unlike the mirrored preview.
   */
  mirror?: boolean;
  /** Crop to the face box, padded by this fraction of its size. */
  cropToFace?: boolean;
  /** @default 0.4 */
  cropPadding?: number;
  format?: 'image/png' | 'image/jpeg';
  /** JPEG compression level, 0–1. @default 0.9 */
  encodeQuality?: number;
  /** Session pitch baseline, degrees. See GateInput.pitchBaselineDeg. */
  pitchBaselineDeg?: number;
  onCapture?: (frame: CapturedFrame) => void;
}

export interface UseCenteredCaptureReturn {
  state: CaptureState;
  /** Gate verdict for the most recent frame. */
  evaluation: CaptureQuality | null;
  /** Highest-priority instruction for the user, or null when all gates pass. */
  nudge: string | null;
  /** Progress through the hold, 0–1. */
  holdProgress: number;
  result: CapturedFrame | null;
  start: () => void;
  cancel: () => void;
  /** Feed each landmarker result in. Ignored unless running. */
  submit: (result: FaceLandmarkerResult) => void;
}

/**
 * Frontal capture gate.
 *
 * Runs after the liveness challenges, waiting for a frame that is frontal,
 * centred, sharp, well-lit, eyes-open and stable — then captures the best one
 * seen rather than the first one that qualifies. That distinction matters: the
 * challenge engine fires on the first frame over threshold, which is why the
 * old end-of-session capture routinely produced mid-blink and mid-turn photos.
 *
 * On timeout it still resolves, with `quality.passedGates === false`. Liveness
 * verification should not fail because of lighting; let the caller decide.
 */
export function useCenteredCapture(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseCenteredCaptureOptions = {},
): UseCenteredCaptureReturn {
  const {
    gates: gateOverrides,
    holdMs = 600,
    timeoutMs = 8000,
    mirror = false,
    cropToFace = false,
    cropPadding = 0.4,
    format = 'image/jpeg',
    encodeQuality = 0.9,
    pitchBaselineDeg,
    onCapture,
  } = options;

  const [state, setState] = useState<CaptureState>('idle');
  const [evaluation, setEvaluation] = useState<CaptureQuality | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [result, setResult] = useState<CapturedFrame | null>(null);

  const stateRef = useRef<CaptureState>('idle');
  const startedAtRef = useRef(0);
  const holdStartRef = useRef<number | null>(null);
  const poseHistoryRef = useRef<HeadPose[]>([]);

  // Best frame so far, held as raw pixels. Encoding on every improvement would
  // cost >10ms a frame; drawImage costs ~1ms, so snapshot often, encode once.
  const bestCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bestScoreRef = useRef(-1);
  const bestQualityRef = useRef<CaptureQuality | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  const gates: CaptureGates = { ...DEFAULT_CAPTURE_GATES, ...gateOverrides };
  const gatesRef = useRef(gates);
  gatesRef.current = gates;

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const setPhase = (next: CaptureState) => {
    stateRef.current = next;
    setState(next);
  };

  const finalise = useCallback(
    (reason: 'captured' | 'timeout') => {
      clearTimer();

      const canvas = bestCanvasRef.current;
      const quality = bestQualityRef.current;

      let frame: CapturedFrame | null = null;
      if (canvas && quality) {
        frame = frameFromCanvas(canvas, {
          format,
          encodeQuality,
          mirrored: mirror,
          captureQuality: quality,
        });
      }

      setResult(frame);
      setPhase(reason);
      setHoldProgress(reason === 'captured' ? 1 : 0);

      if (frame) onCaptureRef.current?.(frame);
    },
    [format, encodeQuality, mirror],
  );

  const start = useCallback(() => {
    clearTimer();
    startedAtRef.current = Date.now();
    holdStartRef.current = null;
    poseHistoryRef.current = [];
    bestScoreRef.current = -1;
    bestQualityRef.current = null;
    setResult(null);
    setEvaluation(null);
    setHoldProgress(0);
    setPhase('searching');

    // Wall-clock deadline, independent of the frame loop — otherwise a face
    // that leaves the frame entirely would stall the phase forever, since
    // submit() is the only other thing that advances it.
    timeoutRef.current = setTimeout(() => finalise('timeout'), timeoutMs);
  }, [timeoutMs, finalise]);

  const cancel = useCallback(() => {
    clearTimer();
    holdStartRef.current = null;
    poseHistoryRef.current = [];
    setHoldProgress(0);
    setPhase('idle');
  }, []);

  const submit = useCallback(
    (res: FaceLandmarkerResult) => {
      const phase = stateRef.current;
      if (phase !== 'searching' && phase !== 'holding') return;

      const video = videoRef.current;
      if (!video) return;

      // Pose history for the stability gate.
      if (res.pose) {
        const hist = poseHistoryRef.current;
        hist.push(res.pose);
        if (hist.length > gatesRef.current.stabilityWindow) hist.shift();
      } else {
        poseHistoryRef.current = [];
      }

      const image = measureFrameQuality(video, { region: res.geometry?.box });

      const verdict = evaluateGates(
        {
          faceCount: res.faceCount,
          pose: res.pose,
          geometry: res.geometry,
          image,
          eyeBlink: Math.max(
            res.blendshapes.eyeBlinkLeft ?? 0,
            res.blendshapes.eyeBlinkRight ?? 0,
          ),
          jawOpen: res.blendshapes.jawOpen ?? 0,
          smile: Math.max(
            res.blendshapes.mouthSmileLeft ?? 0,
            res.blendshapes.mouthSmileRight ?? 0,
          ),
          poseJitterDeg: poseJitter(poseHistoryRef.current),
          pitchBaselineDeg,
        },
        gatesRef.current,
      );

      setEvaluation(verdict);

      if (!verdict.passedGates) {
        // Any failure restarts the hold — a pose has to be sustained, not
        // merely touched.
        holdStartRef.current = null;
        setHoldProgress(0);
        if (phase !== 'searching') setPhase('searching');
        return;
      }

      // Snapshot whenever this is the best frame yet.
      if (verdict.score > bestScoreRef.current) {
        if (!bestCanvasRef.current) bestCanvasRef.current = document.createElement('canvas');
        const drawn = drawVideoFrame(video, bestCanvasRef.current, {
          mirror,
          crop:
            cropToFace && res.geometry
              ? { box: res.geometry.box, paddingRatio: cropPadding }
              : undefined,
        });
        if (drawn) {
          bestScoreRef.current = verdict.score;
          bestQualityRef.current = verdict;
        }
      }

      const now = Date.now();
      if (holdStartRef.current === null) {
        holdStartRef.current = now;
        setPhase('holding');
      }

      const held = now - holdStartRef.current;
      setHoldProgress(Math.min(1, held / holdMs));

      if (held >= holdMs && bestQualityRef.current) finalise('captured');
    },
    [videoRef, holdMs, mirror, cropToFace, cropPadding, pitchBaselineDeg, finalise],
  );

  useEffect(() => clearTimer, []);

  const nudge = evaluation?.failures[0]?.message ?? null;

  return { state, evaluation, nudge, holdProgress, result, start, cancel, submit };
}
