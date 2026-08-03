// dev/calibrate.ts
//
// Threshold calibration harness. NOT part of the published package.
//
// Pose sign conventions and quality thresholds cannot be derived on paper —
// MediaPipe's transformation matrix lives in unmirrored camera space while the
// preview is rendered mirrored, and sharpness/brightness are sensor-dependent.
// This page measures the real thing on a real device using the exact production
// detection config, then emits the constants to paste back into source.
//
//   npm run calibrate   → http://127.0.0.1:8000

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  derivePose,
  deriveGeometry,
  pickPrimaryFace,
  type HeadPose,
  type FaceGeometry,
} from '../src/utils/facePose';
import { measureFrameQuality, type FrameQuality } from '../src/utils/frameQuality';
import {
  DEFAULT_WASM_BASE_PATH,
  MEDIAPIPE_WASM_VERSION,
  faceLandmarkerOptions,
} from '../src/utils/mediapipeConfig';

// ---------------------------------------------------------------------------
// Metric model
// ---------------------------------------------------------------------------

interface Metrics {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  legacyHeadYaw: number;
  centerOffset: number;
  eyeSpan: number;
  boxWidth: number;
  boxHeight: number;
  sharpness: number;
  sharpnessScore: number;
  brightness: number;
  underexposed: number;
  overexposed: number;
  eyeBlinkMax: number;
  jawOpen: number;
  smileMax: number;
}

const METRIC_KEYS: (keyof Metrics)[] = [
  'yawDeg', 'pitchDeg', 'rollDeg', 'legacyHeadYaw',
  'centerOffset', 'eyeSpan', 'boxWidth', 'boxHeight',
  'sharpness', 'sharpnessScore', 'brightness', 'underexposed', 'overexposed',
  'eyeBlinkMax', 'jawOpen', 'smileMax',
];

/** Scenarios to record. Each one pins down a different threshold. */
// Each scenario must move exactly ONE metric away from frontal. Changing two at
// once (turning while also smiling, blurring while also stepping back) produces
// a bracket that cannot attribute the difference to either cause.
const SCENARIOS = [
  { id: 'frontal',  label: 'Good frontal',
    hint: 'Face the camera straight on, well lit, arm’s length. Shift and resettle naturally a few times — do NOT freeze, or the spread will be sensor noise.' },
  // Reject-side, like tooFar/tooDark/blurred — every scenario must describe the
  // FIRST unacceptable state so bracket() can midpoint against frontal. Asking
  // for the last *acceptable* pose here silently produced a threshold half the
  // value the operator had just declared fine.
  { id: 'yawLimit', label: 'Yaw limit',
    hint: 'Turn your head sideways until it is too turned to be worth capturing — the first pose you would REJECT — and hold it. Turn only: no smiling, nodding or leaning.' },
  { id: 'tooFar',   label: 'Too far',
    hint: 'Move back until the face is too small to be worth capturing. Keep lighting and pose unchanged.' },
  { id: 'tooDark',  label: 'Too dark',
    hint: 'Dim the lights or turn away from the window. Stay at the same distance.' },
  { id: 'blurred',  label: 'Motion blur',
    hint: 'Move your head continuously, never holding still — but stay at the same distance from the camera.' },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]['id'];

// Wall-clock, not a frame count. A 60-frame sample was one second of near-frozen
// video, so p05/p95 measured sensor noise rather than how a real user varies —
// and every threshold bracketed off that spread came out far too tight.
const SAMPLE_MS = 6000;
const MIN_USABLE_FRAMES = 90;

interface Sample {
  frames: Metrics[];
  warning: string | null;
}

const samples: Partial<Record<ScenarioId, Sample>> = {};

// Sign-calibration captures: axis → observed sign at the prompted extreme.
const signChecks: { yaw?: number; pitch?: number; roll?: number } = {};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

interface Stat { min: number; p05: number; median: number; p95: number; max: number }

function summarise(frames: Metrics[], key: keyof Metrics): Stat {
  const vals = frames.map((f) => f[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    min: vals[0],
    p05: percentile(vals, 0.05),
    median: percentile(vals, 0.5),
    p95: percentile(vals, 0.95),
    max: vals[vals.length - 1],
  };
}

function absSummarise(frames: Metrics[], key: keyof Metrics): Stat {
  return summarise(frames.map((f) => ({ ...f, [key]: Math.abs(f[key]) })), key);
}

// ---------------------------------------------------------------------------
// Scenario validation
//
// Every scenario exists to move ONE metric decisively away from frontal. If it
// didn't, the resulting bracket is meaningless — and silently so, which is
// worse than no data. These checks run the moment a recording finishes, while
// the operator is still in position to redo it.
// ---------------------------------------------------------------------------

function validate(id: ScenarioId, frames: Metrics[]): string | null {
  if (frames.length < MIN_USABLE_FRAMES) {
    return `Only ${frames.length} frames captured (need ${MIN_USABLE_FRAMES}) — was the face in view throughout?`;
  }

  if (id === 'frontal') {
    // A sample with no spread cannot characterise normal variation.
    const span = summarise(frames, 'centerOffset');
    const eye = summarise(frames, 'eyeSpan');
    if (span.p95 - span.p05 < 0.006 && eye.p95 - eye.p05 < 0.006) {
      return 'Held too still — shift and resettle naturally so the spread reflects real users, not sensor noise.';
    }
    return null;
  }

  const frontal = samples.frontal?.frames;
  if (!frontal) return 'Record "Good frontal" first — this scenario is only meaningful relative to it.';

  switch (id) {
    case 'yawLimit': {
      const base = absSummarise(frontal, 'yawDeg').p95;
      const got = absSummarise(frames, 'yawDeg').median;
      if (got < base + 5) {
        return `No head turn detected (|yaw| ${got.toFixed(1)}° vs frontal ${base.toFixed(1)}°). Turn your head — do not smile, nod or lean.`;
      }
      return null;
    }
    case 'tooFar': {
      const got = summarise(frames, 'eyeSpan').median;
      const base = summarise(frontal, 'eyeSpan').p05;
      if (got >= base) return `Not far enough (eyeSpan ${got.toFixed(3)} vs frontal ${base.toFixed(3)}).`;
      return null;
    }
    case 'tooDark': {
      const got = summarise(frames, 'brightness').median;
      const base = summarise(frontal, 'brightness').p05;
      if (got >= base) return `Not dark enough (brightness ${got.toFixed(1)} vs frontal ${base.toFixed(1)}).`;
      return null;
    }
    case 'blurred': {
      const got = summarise(frames, 'sharpness').median;
      const base = summarise(frontal, 'sharpness').p05;
      const eye = summarise(frames, 'eyeSpan').median;
      const eyeBase = summarise(frontal, 'eyeSpan').p05;
      if (eye < eyeBase * 0.85) {
        return `You also moved further away (eyeSpan ${eye.toFixed(3)} vs ${eyeBase.toFixed(3)}) — that confounds sharpness with distance. Stay at the same distance and only move your head.`;
      }
      if (got >= base) return `Not blurred enough (sharpness ${got.toFixed(0)} vs frontal ${base.toFixed(0)}).`;
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id)!;

const video = $('video') as HTMLVideoElement;
const readout = $('readout');
const statusEl = $('status');
const scenarioList = $('scenarios');
const signList = $('signs');
const output = $('output') as HTMLTextAreaElement;

let landmarker: FaceLandmarker | null = null;
let latest: Metrics | null = null;
let recording: { id: ScenarioId; frames: Metrics[]; startedAt: number } | null = null;

function setStatus(text: string, tone: 'info' | 'ok' | 'warn' = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${tone}`;
}

// ---------------------------------------------------------------------------
// Detection loop
// ---------------------------------------------------------------------------

async function start() {
  setStatus('Requesting camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    // Match useCamera's constraints — resolution changes sharpness readings.
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  setStatus(`Loading MediaPipe ${MEDIAPIPE_WASM_VERSION}…`);
  const fileset = await FilesetResolver.forVisionTasks(DEFAULT_WASM_BASE_PATH);
  const options = faceLandmarkerOptions();
  landmarker = await FaceLandmarker.createFromOptions(fileset, options);

  setStatus(`Running — ${options.baseOptions.delegate} delegate`, 'ok');
  requestAnimationFrame(loop);
}

function loop() {
  requestAnimationFrame(loop);
  if (!landmarker || video.readyState < 2) return;

  let result;
  try {
    result = landmarker.detectForVideo(video, performance.now());
  } catch {
    return;
  }

  const faces = result.faceLandmarks ?? [];
  if (!faces.length) {
    latest = null;
    renderReadout(null, 0);
    // Without this the recording stalls indefinitely showing "hold the pose"
    // with no indication that nothing is being captured.
    if (recording) {
      setStatus(
        `⏸ "${recording.id}" paused — no face detected (${recording.frames.length} frames so far)`,
        'warn',
      );
    }
    return;
  }

  const primary = pickPrimaryFace(faces);
  const landmarks = faces[primary];
  const pose = derivePose(result.facialTransformationMatrixes?.[primary]?.data, landmarks);
  const geometry = deriveGeometry(landmarks);
  const quality = measureFrameQuality(video, { region: geometry?.box });

  const blend: Record<string, number> = {};
  for (const c of result.faceBlendshapes?.[primary]?.categories ?? []) {
    blend[c.categoryName] = c.score;
  }

  // Legacy headYaw, recomputed here so its sign can be compared directly
  // against the matrix-derived yaw — the whole point of the sign check.
  const nose = landmarks[1];
  const lc = landmarks[234];
  const rc = landmarks[454];
  const legacyHeadYaw = nose && lc && rc ? nose.x - (lc.x + rc.x) / 2 : NaN;

  latest = {
    yawDeg: pose?.yawDeg ?? NaN,
    pitchDeg: pose?.pitchDeg ?? NaN,
    rollDeg: pose?.rollDeg ?? NaN,
    legacyHeadYaw,
    centerOffset: geometry?.centerOffset ?? NaN,
    eyeSpan: geometry?.eyeSpan ?? NaN,
    boxWidth: geometry?.box.width ?? NaN,
    boxHeight: geometry?.box.height ?? NaN,
    sharpness: quality?.sharpness ?? NaN,
    sharpnessScore: quality?.sharpnessScore ?? NaN,
    brightness: quality?.brightness ?? NaN,
    underexposed: quality?.underexposed ?? NaN,
    overexposed: quality?.overexposed ?? NaN,
    eyeBlinkMax: Math.max(blend.eyeBlinkLeft ?? 0, blend.eyeBlinkRight ?? 0),
    jawOpen: blend.jawOpen ?? 0,
    smileMax: Math.max(blend.mouthSmileLeft ?? 0, blend.mouthSmileRight ?? 0),
  };

  if (recording) {
    recording.frames.push(latest);
    const elapsed = performance.now() - recording.startedAt;

    if (elapsed >= SAMPLE_MS) {
      const { id, frames } = recording;
      recording = null;
      const warning = validate(id, frames);
      samples[id] = { frames, warning };
      renderScenarios();
      setStatus(
        warning ? `⚠ "${id}": ${warning}` : `Recorded "${id}" — ${frames.length} frames, looks good`,
        warning ? 'warn' : 'ok',
      );
    } else {
      const pct = Math.round((elapsed / SAMPLE_MS) * 100);
      setStatus(`● Recording "${recording.id}" — ${pct}% (${recording.frames.length} frames)`, 'warn');
    }
  }

  renderReadout(pose, faces.length, geometry, quality);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fmt = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '—');

function renderReadout(
  pose: HeadPose | null,
  faceCount: number,
  geometry?: FaceGeometry | null,
  quality?: FrameQuality | null,
) {
  if (!latest) {
    readout.innerHTML = '<div class="empty">No face detected</div>';
    return;
  }

  const m = latest;
  const rows: [string, string, string?][] = [
    ['yaw', `${fmt(m.yawDeg, 1)}°`, pose?.source],
    ['pitch', `${fmt(m.pitchDeg, 1)}°`, pose?.source],
    ['roll', `${fmt(m.rollDeg, 1)}°`, pose?.source],
    ['headYaw (legacy)', fmt(m.legacyHeadYaw, 4)],
    ['faces', String(faceCount), faceCount > 1 ? 'intruder' : undefined],
    ['centerOffset', fmt(m.centerOffset, 3)],
    ['eyeSpan', fmt(m.eyeSpan, 3)],
    ['box', `${fmt(geometry?.box.width ?? NaN, 3)} × ${fmt(geometry?.box.height ?? NaN, 3)}`],
    ['sharpness', fmt(m.sharpness, 1)],
    ['sharpnessScore', fmt(m.sharpnessScore, 3)],
    ['brightness', fmt(m.brightness, 1)],
    ['under / over', `${fmt(m.underexposed, 3)} / ${fmt(m.overexposed, 3)}`],
    ['eyeBlink', fmt(m.eyeBlinkMax, 3)],
    ['jawOpen', fmt(m.jawOpen, 3)],
    ['smile', fmt(m.smileMax, 3)],
  ];

  readout.innerHTML = rows
    .map(
      ([k, v, tag]) =>
        `<div class="row"><span class="k">${k}</span><span class="v">${v}</span>${
          tag ? `<span class="tag">${tag}</span>` : ''
        }</div>`,
    )
    .join('');

  void quality;
}

function renderScenarios() {
  scenarioList.innerHTML = SCENARIOS.map((s) => {
    const have = samples[s.id];
    const bad = have?.warning;
    return `
      <div class="scenario ${have ? (bad ? 'bad' : 'have') : ''}">
        <div class="scenario-head">
          <strong>${s.label}</strong>
          <button data-scenario="${s.id}">${have ? 'Re-record' : 'Record'}</button>
        </div>
        <p>${s.hint}</p>
        ${
          have
            ? bad
              ? `<code class="bad">⚠ ${bad}</code>`
              : `<code>${have.frames.length} frames — valid</code>`
            : ''
        }
      </div>`;
  }).join('');

  scenarioList.querySelectorAll('button[data-scenario]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!landmarker) return setStatus('Click "Start camera" first', 'warn');
      const id = (btn as HTMLElement).dataset.scenario as ScenarioId;
      const sc = SCENARIOS.find((s) => s.id === id)!;
      setStatus(`● Recording "${sc.label}" — ${SAMPLE_MS / 1000}s, hold the pose…`, 'warn');
      recording = { id, frames: [], startedAt: performance.now() };
    });
  });
}

function renderSigns() {
  const axes = [
    { id: 'yaw' as const, prompt: 'Turn your head to YOUR OWN LEFT, then click.' },
    { id: 'pitch' as const, prompt: 'Tilt your chin UP, then click.' },
    { id: 'roll' as const, prompt: 'Tilt your head toward your RIGHT shoulder, then click.' },
  ];

  signList.innerHTML = axes
    .map((a) => {
      const v = signChecks[a.id];
      const state = v === undefined ? '—' : v > 0 ? 'positive' : 'negative';
      return `
        <div class="scenario ${v !== undefined ? 'have' : ''}">
          <div class="scenario-head">
            <strong>${a.id}</strong>
            <button data-sign="${a.id}">Capture</button>
          </div>
          <p>${a.prompt}</p>
          <code>observed: ${state}</code>
        </div>`;
    })
    .join('');

  signList.querySelectorAll('button[data-sign]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.sign as 'yaw' | 'pitch' | 'roll';
      if (!latest) return setStatus('No face detected', 'warn');
      const val = id === 'yaw' ? latest.yawDeg : id === 'pitch' ? latest.pitchDeg : latest.rollDeg;
      if (!Number.isFinite(val)) return setStatus('No pose available', 'warn');
      signChecks[id] = Math.sign(val);
      renderSigns();
      setStatus(`${id}: observed ${val > 0 ? 'positive' : 'negative'} (${fmt(val, 1)}°)`, 'ok');
    });
  });
}

// ---------------------------------------------------------------------------
// Threshold derivation
//
// Each suggestion is bracketed between the scenario you want ACCEPTED and the
// scenario you want REJECTED, then placed with margin. Where a bracket is
// inverted (accept and reject overlap) the metric cannot separate those cases
// on this device and is reported as such rather than silently split.
// ---------------------------------------------------------------------------

function bracket(
  accept: number,
  reject: number,
  /**
   * Which side of the threshold the ACCEPTED scenario must fall on.
   * Required — without it an overlap is indistinguishable from clean
   * separation, and a threshold that cannot separate the two cases would be
   * emitted looking perfectly reasonable.
   */
  direction: 'acceptBelow' | 'acceptAbove',
  label: string,
): string {
  if (!Number.isFinite(accept) || !Number.isFinite(reject)) {
    return `null, // ${label}: missing samples`;
  }
  const separated = direction === 'acceptBelow' ? accept < reject : accept > reject;
  const value = (accept + reject) / 2;
  return `${value.toFixed(3)}, // ${label}${
    separated ? '' : ' — ⚠ OVERLAP: this metric cannot separate these cases on this device'
  }`;
}

function deriveThresholds(): string {
  const frontal = samples.frontal?.frames;
  if (!frontal) {
    return '// Nothing to derive — click "Record" on the "Good frontal" scenario in section 2.\n// Every other threshold is bracketed against it.';
  }

  const lines: string[] = [];

  // Surface invalid samples at the top of the output rather than letting them
  // quietly poison individual thresholds further down.
  const invalid = SCENARIOS.filter((s) => samples[s.id]?.warning);
  const missing = SCENARIOS.filter((s) => !samples[s.id]);
  if (invalid.length || missing.length) {
    lines.push('// ⚠ THIS RUN IS INCOMPLETE — do not paste these values yet.');
    for (const s of invalid) lines.push(`//   ${s.id}: ${samples[s.id]!.warning}`);
    for (const s of missing) lines.push(`//   ${s.id}: not recorded`);
    lines.push('');
  }

  // --- Sign constants -------------------------------------------------------
  lines.push('// src/utils/facePose.ts');
  const sign = (v: number | undefined, expectPositive: boolean) =>
    v === undefined ? 1 : (v > 0) === expectPositive ? 1 : -1;
  lines.push('const SIGN = {');
  lines.push(`  yaw: ${sign(signChecks.yaw, true)},   // + when the user turns to their own left`);
  lines.push(`  pitch: ${sign(signChecks.pitch, true)}, // + when the chin lifts`);
  lines.push(`  roll: ${sign(signChecks.roll, true)},  // + when tilting toward the right shoulder`);
  lines.push('} as const;');
  lines.push('');

  // --- Sharpness normalisation ---------------------------------------------
  const frontalSharp = summarise(frontal, 'sharpness');
  lines.push('// src/utils/frameQuality.ts');
  lines.push(`const SHARPNESS_HALF_SCORE = ${frontalSharp.median.toFixed(0)}; // median sharpness of a good frontal frame`);
  lines.push('');

  // --- Capture gates --------------------------------------------------------
  lines.push('// Capture gate defaults (step 4)');
  lines.push('const CAPTURE_GATES = {');

  const yawFrontal = absSummarise(frontal, 'yawDeg');
  const yawLimit = samples.yawLimit ? absSummarise(samples.yawLimit.frames, 'yawDeg') : null;
  lines.push(
    `  maxYawDeg: ${
      yawLimit
        ? bracket(yawFrontal.p95, yawLimit.median, 'acceptBelow', 'frontal p95 → yaw-limit median')
        : `${Math.max(8, yawFrontal.p95 * 2).toFixed(1)}, // no yawLimit sample — 2× frontal p95`
    }`,
  );

  const pitchFrontal = absSummarise(frontal, 'pitchDeg');
  const rollFrontal = absSummarise(frontal, 'rollDeg');
  lines.push(`  maxPitchDeg: ${Math.max(8, pitchFrontal.p95 * 2).toFixed(1)}, // 2× frontal p95`);
  lines.push(`  maxRollDeg: ${Math.max(6, rollFrontal.p95 * 2).toFixed(1)}, // 2× frontal p95`);

  const centerFrontal = summarise(frontal, 'centerOffset');
  lines.push(`  maxCenterOffset: ${Math.max(0.08, centerFrontal.p95 * 1.5).toFixed(3)}, // 1.5× frontal p95`);

  const spanFrontal = summarise(frontal, 'eyeSpan');
  const spanFar = samples.tooFar ? summarise(samples.tooFar.frames, 'eyeSpan') : null;
  lines.push(
    `  minEyeSpan: ${
      spanFar
        ? bracket(spanFrontal.p05, spanFar.max, 'acceptAbove', 'frontal p05 → too-far max')
        : `${(spanFrontal.p05 * 0.7).toFixed(3)}, // no tooFar sample — 70% of frontal p05`
    }`,
  );

  const sharpBlur = samples.blurred ? summarise(samples.blurred.frames, 'sharpness') : null;
  lines.push(
    `  minSharpness: ${
      sharpBlur
        ? bracket(frontalSharp.p05, sharpBlur.p95, 'acceptAbove', 'frontal p05 → blurred p95')
        : `${(frontalSharp.p05 * 0.6).toFixed(1)}, // no blurred sample — 60% of frontal p05`
    }`,
  );

  const brightFrontal = summarise(frontal, 'brightness');
  const brightDark = samples.tooDark ? summarise(samples.tooDark.frames, 'brightness') : null;
  lines.push(
    `  minBrightness: ${
      brightDark
        ? bracket(brightFrontal.p05, brightDark.max, 'acceptAbove', 'frontal p05 → too-dark max')
        : `${(brightFrontal.p05 * 0.6).toFixed(1)}, // no tooDark sample — 60% of frontal p05`
    }`,
  );

  const blinkFrontal = summarise(frontal, 'eyeBlinkMax');
  lines.push(`  maxEyeBlink: ${Math.max(0.3, blinkFrontal.p95 * 1.5).toFixed(3)}, // eyes-open gate`);
  lines.push('};');
  lines.push('');

  // --- Raw stats ------------------------------------------------------------
  lines.push('/* Raw per-scenario stats');
  for (const s of SCENARIOS) {
    const f = samples[s.id]?.frames;
    if (!f) { lines.push(`  ${s.id}: (not recorded)`); continue; }
    lines.push(`  ${s.id}:`);
    for (const k of METRIC_KEYS) {
      const st = summarise(f, k);
      lines.push(
        `    ${k.padEnd(16)} min=${fmt(st.min, 3)} p05=${fmt(st.p05, 3)} med=${fmt(st.median, 3)} p95=${fmt(st.p95, 3)} max=${fmt(st.max, 3)}`,
      );
    }
  }
  lines.push('*/');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$('start').addEventListener('click', () => {
  start().catch((err) => setStatus(`Failed: ${err?.message ?? err}`, 'warn'));
});

$('derive').addEventListener('click', () => {
  output.value = deriveThresholds();
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.value);
  setStatus('Copied to clipboard', 'ok');
});

$('reset').addEventListener('click', () => {
  for (const s of SCENARIOS) delete samples[s.id];
  delete signChecks.yaw; delete signChecks.pitch; delete signChecks.roll;
  output.value = '';
  renderScenarios();
  renderSigns();
  setStatus('Samples cleared');
});

renderScenarios();
renderSigns();
setStatus('Click Start to begin');
