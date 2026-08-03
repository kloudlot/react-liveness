// dev/demo.tsx
//
// Smoke-test harness for the LivenessCheck session machine. NOT published.
//
// The align and capture phases are asynchronous and gated on live camera input,
// so typecheck and build prove nothing about whether the machine actually
// advances. This page runs it end to end and logs every transition.
//
//   npm run playground   → http://127.0.0.1:8000/demo.html

import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { LivenessCheck } from '../src/components/LivenessCheck';
import type { CapturedFrame, ChallengeResult } from '../src/types';
import type { VerificationVerdict } from '../src/hooks/useVerification';

/** Fake backend verdicts, so every branch of the verify flow is reachable. */
const VERDICTS = {
  verified: { status: 'verified' } as VerificationVerdict,
  low_quality: {
    status: 'rejected',
    reason: 'low_quality',
    message: 'The photo was too blurry to compare.',
  } as VerificationVerdict,
  no_match: {
    status: 'rejected',
    reason: 'no_match',
    message: 'We could not match your face to your record.',
  } as VerificationVerdict,
  policy: {
    status: 'rejected',
    reason: 'policy',
    message: 'You have already checked in today.',
  } as VerificationVerdict,
  error: { status: 'error', message: 'Service unavailable (simulated).' } as VerificationVerdict,
  throw: { status: 'verified' } as VerificationVerdict, // handled specially
} as const;

type VerdictKey = keyof typeof VERDICTS;

interface LogEntry {
  at: string;
  event: string;
  detail: string;
}

/** Abortable delay — proves ctx.signal actually cancels an in-flight verify. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function Demo() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [shots, setShots] = useState<{ label: string; url: string }[]>([]);
  const [verdictKey, setVerdictKey] = useState<VerdictKey>('verified');
  const [latency, setLatency] = useState(1500);

  // Read through refs so changing the selector mid-flight affects the next call
  // rather than being captured at mount.
  const verdictRef = useRef(verdictKey);
  verdictRef.current = verdictKey;
  const latencyRef = useRef(latency);
  latencyRef.current = latency;

  const push = (event: string, detail: string) =>
    setLog((l) => [
      { at: new Date().toLocaleTimeString([], { hour12: false }), event, detail },
      ...l,
    ]);

  const describe = (f: CapturedFrame) => {
    const q = f.quality;
    if (!q) return `${f.width}×${f.height}, mirrored=${f.mirrored}, no gate metadata`;
    const p = q.pose;
    return [
      `${f.width}×${f.height}`,
      `mirrored=${f.mirrored}`,
      `score=${q.score.toFixed(3)}`,
      `gates=${q.passedGates ? 'PASS' : 'FAIL'}`,
      p ? `yaw=${p.yawDeg.toFixed(1)}° pitch=${p.pitchDeg.toFixed(1)}° roll=${p.rollDeg.toFixed(1)}°` : 'no pose',
      q.geometry ? `eyeSpan=${q.geometry.eyeSpan.toFixed(3)}` : '',
      q.image ? `sharp=${q.image.sharpness.toFixed(0)} bright=${q.image.brightness.toFixed(0)}` : '',
      q.failures.length ? `failures=[${q.failures.map((x) => x.gate).join(', ')}]` : '',
    ]
      .filter(Boolean)
      .join('  ');
  };

  return (
    <div className="wrap">
      <div>
        <LivenessCheck
          numberOfChallenge={2}
          brandLabel="Playground"
          orgLabel="Dev"
          employeeName="Test User"
          employeeId="EMP-001"
          onAlignCapture={(f) => {
            push('onAlignCapture', describe(f));
            setShots((s) => [...s, { label: 'align (pre-challenge)', url: f.dataUrl }]);
          }}
          onCapture={(f) => {
            push('onCapture', describe(f));
            setShots((s) => [...s, { label: 'gated capture', url: f.dataUrl }]);
          }}
          onComplete={(passed: boolean, results: ChallengeResult[], frame?: CapturedFrame) => {
            push(
              'onComplete',
              `passed=${passed}  results=[${results
                .map((r) => `${r.type}:${r.passed ? 'ok' : 'timeout'}`)
                .join(', ')}]  frame=${frame ? 'yes' : 'none'}`,
            );
          }}
          onVerify={async (payload, ctx) => {
            push(
              'onVerify',
              `attempt=${payload.attempt} session=${payload.sessionId.slice(0, 12)}… align=${payload.alignFrame ? 'yes' : 'no'}`,
            );
            ctx.setStage('Uploading…');
            await sleep(latencyRef.current / 2, ctx.signal);
            ctx.setStage('Comparing face…');
            await sleep(latencyRef.current / 2, ctx.signal);

            const key = verdictRef.current;
            if (key === 'throw') throw new Error('Simulated network failure');
            push('verdict', JSON.stringify(VERDICTS[key]));
            return VERDICTS[key];
          }}
          onSettled={(v) => push('onSettled', JSON.stringify(v))}
          onFallback={() => push('onFallback', 'supervisor fallback tapped')}
        />

        <div className="controls">
          <h2>Simulated backend</h2>
          <label>
            Verdict
            <select
              value={verdictKey}
              onChange={(e) => setVerdictKey(e.target.value as VerdictKey)}
            >
              <option value="verified">verified</option>
              <option value="low_quality">rejected · low_quality (retake photo)</option>
              <option value="no_match">rejected · no_match (full restart)</option>
              <option value="policy">rejected · policy (no retry)</option>
              <option value="error">error verdict (resubmit)</option>
              <option value="throw">thrown exception (resubmit)</option>
            </select>
          </label>
          <label>
            Latency {latency}ms
            <input
              type="range"
              min={200}
              max={8000}
              step={100}
              value={latency}
              onChange={(e) => setLatency(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div>
        <h2>Event log</h2>
        <p className="hint">
          Expected order: <code>onAlignCapture</code> → challenges →{' '}
          <code>onCapture</code> → <code>onComplete</code>. The gated capture must
          be frontal with eyes open, regardless of which challenge ran last.
        </p>
        <div className="log">
          {log.length === 0 && <div className="empty">No events yet — start a session.</div>}
          {log.map((e, i) => (
            <div className="entry" key={i}>
              <span className="ts">{e.at}</span>
              <strong>{e.event}</strong>
              <span className="detail">{e.detail}</span>
            </div>
          ))}
        </div>

        {shots.length > 0 && (
          <>
            <h2>Captured frames</h2>
            <p className="hint">Shown unmirrored, as the backend receives them.</p>
            <div className="shots">
              {shots.map((s, i) => (
                <figure key={i}>
                  <img src={s.url} alt={s.label} />
                  <figcaption>{s.label}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
