# @kloudlot/react-liveness

Headless React liveness check component using MediaPipe Face Landmarker.
Works in Next.js (App Router), Vite, and any React 18+ project.
No CDN script tags. No global pollution. GPU/CPU auto-detected per device.

Runs randomised liveness challenges, then captures a **frontal, eyes-open,
in-focus photo** suitable for backend face comparison — and defers the
"verified" verdict to your backend rather than claiming it locally.

## Installation

```bash
npm install @kloudlot/react-liveness @mediapipe/tasks-vision
```

`@mediapipe/tasks-vision` is a peer dependency — you control the version.

---

## Quick start — drop-in component

```tsx
import { LivenessCheck } from '@kloudlot/react-liveness';

export default function AttendancePage() {
  return (
    <LivenessCheck
      // Submit the capture and let your backend decide. The component shows
      // "verified" only after this returns { status: 'verified' }.
      onVerify={async ({ sessionId, results, frame }, ctx) => {
        ctx.setStage('Uploading…');

        const fd = new FormData();
        fd.append('photo', await frame.blob(), 'liveness.jpg');
        fd.append('sessionId', sessionId);
        fd.append('results', JSON.stringify(results));
        fd.append('quality', JSON.stringify(frame.quality));

        const res = await fetch('/api/attendance/verify', {
          method: 'POST',
          body: fd,
          signal: ctx.signal,
        });
        if (!res.ok) throw new Error('Service unavailable');

        const { match } = await res.json();
        return match
          ? { status: 'verified' }
          : { status: 'rejected', reason: 'no_match', message: 'We could not match your face.' };
      }}
    />
  );
}
```

`onVerify` is optional. Without it, a liveness pass is the final answer — which
is the 1.0.x behaviour, and is only appropriate if you verify identity
elsewhere. **Liveness proves a live human is present. It never proves *which*
human.**

---

## Session flow

```
idle → waiting → aligning → detecting → capturing → verifying → complete
                     │           │           │
                     ▼           ▼           ├──→ rejected   (backend said no)
                  failed ────────┘           └──→ error      (backend unreachable)
```

| Phase | What happens |
|---|---|
| `aligning` | Short framing step. Establishes the per-device pitch baseline and captures a pre-challenge frontal frame. |
| `detecting` | The randomised liveness challenges. |
| `capturing` | Waits for a frontal, centred, sharp, eyes-open, stable frame and keeps the **best** one seen. |
| `verifying` | Your `onVerify` is in flight. The camera stays live — see [Retries](#retries). |

---

## Props

### Core

| Prop | Type | Default | Description |
|---|---|---|---|
| `onComplete` | `(passed, results, frame?) => void` | — | Fires when the **liveness stage** resolves, before verification |
| `onVerify` | `(payload, ctx) => Promise<Verdict>` | — | Submit to your backend and return its verdict |
| `onSettled` | `(verdict) => void` | — | Fires once per terminal backend verdict |
| `numberOfChallenge` | `number` | `3` | How many challenges to present |
| `challengePool` | `Challenge[]` | Default set | Override the pool challenges are drawn from |
| `theme` | `LivenessTheme` | — | High-level color theming |
| `styles` | `LivenessStyles` | — | Overrides for specific internal DOM elements |
| `className` | `string` | — | CSS class on the root container |
| `loadFonts` | `boolean` | `false` | Load Space Grotesk / Space Mono from Google Fonts |
| `ariaLabel` | `string` | `"Liveness verification"` | Accessible name for the widget |

### Capture

| Prop | Type | Default | Description |
|---|---|---|---|
| `captureMode` | `'centeredFace' \| 'onComplete' \| 'off'` | `'centeredFace'` | How the photo is chosen |
| `captureGates` | `Partial<CaptureGates>` | Calibrated defaults | Threshold overrides |
| `captureHoldMs` | `number` | `600` | How long all gates must hold before capturing |
| `captureTimeoutMs` | `number` | `8000` | Give up and keep the best frame seen |
| `cropToFace` | `boolean` | `false` | Crop the capture to the face box |
| `alignPhase` | `boolean` | `true` | Run the pre-challenge framing step |
| `continuityGuard` | `boolean` | `true` | Fail if tracking drops before the photo |
| `maxTrackingGapMs` | `number` | `1200` | Tracking gap tolerated during capture |
| `onCapture` | `(frame) => void` | — | The gated capture |
| `onAlignCapture` | `(frame) => void` | — | The pre-challenge framing frame |

### Verification

| Prop | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `3` | Rejections before retries stop |
| `verifyTimeoutMs` | `number` | `30000` | Abort the verify call after this long |
| `maxCaptureRetries` | `number` | `1` | Capture-only retries per liveness proof |

### Identity display

| Prop | Type | Description |
|---|---|---|
| `brandLabel` | `string` | Product name, top left |
| `orgLabel` | `string` | Organization pill, top right |
| `employeeName` | `string` | Shown on success — **only meaningful with `onVerify`** |
| `employeeId` | `string` | As above |
| `onCancel` | `() => void` | Cancel tapped mid-session |
| `onFallback` | `() => void` | Supervisor-fallback link after a failure |

---

## Customization (Theming & Styling)

The `LivenessCheck` component provides rich customization out of the box.

### Theme Prop (Quick Colors)

Pass an object to `theme={...}` to override the main color palette using CSS variables.

```tsx
<LivenessCheck
  theme={{
    primary: '#6366f1', // Indigo
    success: '#22c55e', // Green
    surface: '#1e293b', // Dark mode background
    text: '#f8fafc',    // Dark mode text
  }}
/>
```

Available theme keys: `primary`, `success`, `danger`, `warning`, `background`, `surface`, `text`, `border`.

### Styles Prop (Deep Customization)

For deeper control, pass an object of inline style overrides to `styles={...}`. You can target specific elements inside the component.

```tsx
<LivenessCheck
  styles={{
    root: { borderRadius: '12px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' },
    cameraFrame: { borderRadius: '8px' },
    instructionCard: { background: '#f1f5f9' },
    actionButton: { textTransform: 'uppercase', letterSpacing: '1px' }
  }}
/>
```

Available style keys: `root`, `header`, `titleGroup`, `title`, `subtitle`, `secureBadge`, `errorBanner`, `cameraShell`, `cameraFrame`, `video`, `faceGuide`, `idleOverlay`, `loadingOverlay`, `resultOverlay`, `warningPill`, `capturedThumb`, `progressWrapper`, `progressTrack`, `progressFill`, `challengePills`, `challengePill`, `instructionCard`, `instructionIcon`, `instructionText`, `actionWrapper`, `actionButton`, `resultList`, `resultPill`.

---

## Headless usage — bring your own UI

Use the raw hooks if you want full control over the UI:

```tsx
import {
  useCamera,
  useFaceLandmarker,
  useLivenessAudio,
  pickChallenges,
  DEFAULT_CHALLENGES,
} from '@kloudlot/react-liveness';

function MyCustomLiveness() {
  const { videoRef, isCameraReady, startCamera, stopCamera } = useCamera();
  const audio = useLivenessAudio();

  const challenges = pickChallenges(3); // or pass your own pool

  const { isLoading, startDetection } = useFaceLandmarker(videoRef, {
    enabled: true,
    onResult: ({ blendshapes, faceDetected, landmarks, pose, geometry, faceCount }) => {
      // pose     → { yawDeg, pitchDeg, rollDeg, source }
      // geometry → { box, centerOffset, eyeSpan }
      // faceCount > 1 means someone else is in frame
    },
  });

  return <video ref={videoRef} playsInline muted style={{ transform: 'scaleX(-1)' }} />;
}
```

---

## Custom challenges

You can provide your own challenge pool using the `challengePool` prop. The component will randomly pick `numberOfChallenge` challenges from this pool for each verification session.

```tsx
import { LivenessCheck, Challenge } from '@kloudlot/react-liveness';

const MY_CHALLENGES: Challenge[] = [
  {
    type: 'SMILE',
    label: 'Smile',
    instruction: 'Give us a big smile',
    icon: '😊',
    timeoutMs: 5000,
    blendshapes: [
      { key: 'mouthSmileLeft',  threshold: 0.4 },
      { key: 'mouthSmileRight', threshold: 0.4 },
    ],
  },
  {
    type: 'BLINK',
    label: 'Blink',
    instruction: 'Blink both eyes',
    icon: '👁️',
    timeoutMs: 5000,
    blendshapes: [
      { key: 'eyeBlinkLeft',  threshold: 0.5 },
      { key: 'eyeBlinkRight', threshold: 0.5 },
    ],
  },
];

<LivenessCheck 
  numberOfChallenge={2} 
  challengePool={MY_CHALLENGES} 
  onComplete={console.log} 
/>
```

### Available blendshape keys

| Key | Trigger |
|---|---|
| `eyeBlinkLeft` / `eyeBlinkRight` | Eye blink |
| `mouthSmileLeft` / `mouthSmileRight` | Smile |
| `jawOpen` | Open mouth |
| `browInnerUp` | Raise inner brows |
| `headYaw` | Head turn, normalised offset (positive = left on screen) |
| `headNod` | Head nod (synthesised from noseTip.y sliding window) |
| `headYawDeg` / `headPitchDeg` / `headRollDeg` | Head pose in **degrees**, from the facial transformation matrix |

### Comparison modes

By default a condition's direction is inferred from its threshold's sign —
positive means "above", negative means "below". That cannot express a band, so
set `compare` explicitly when you need one:

```ts
// "facing forward" — within ±12°
{ key: 'headYawDeg', threshold: 12, compare: 'absBelow' }

// "turned, either direction"
{ key: 'headYawDeg', threshold: 20, compare: 'absAbove' }
```

Modes: `'above'`, `'below'`, `'absBelow'`, `'absAbove'`.

> `headPitchDeg` carries a device-dependent offset — the camera's height
> relative to the face — so an absolute pitch band behaves differently on a
> laptop than on a phone. The capture gate handles pitch correctly by measuring
> against a per-session baseline; prefer it over a pitch challenge.

Full list: [MediaPipe Face Landmarker blendshapes](https://developers.google.com/mediapipe/solutions/vision/face_landmarker)

---

## Capturing the photo

`onComplete` fires when the **liveness stage** resolves — before verification —
and receives the gated `CapturedFrame`. Its signature is unchanged from 1.0.x.

> **Gated captures are not mirrored.** The preview is mirrored because that is
> what feels natural on screen, but the canonical record for backend comparison
> should be true camera orientation. `frame.mirrored` tells you which you have.
> Calling `captureFrame()` directly still mirrors by default.

```ts
onComplete={async (passed, results, frame) => {
  if (!passed || !frame) return;

  // Option A — base64 for JSON API
  await fetch('/api/verify', {
    method: 'POST',
    body: JSON.stringify({ photo: frame.dataUrl, results }),
  });

  // Option B — blob for multipart upload
  const blob = await frame.blob();
  const fd = new FormData();
  fd.append('photo', blob, 'liveness.jpg');
  await fetch('/api/verify', { method: 'POST', body: fd });
}}
```

---

## Retries

A rejection is not one thing, so "try again" isn't either. The component offers
the retry that matches what actually needs redoing:

| Verdict | Scope | Button | Counts as an attempt? |
|---|---|---|---|
| `error` (or a thrown exception) | resubmit the same photo | Try again | **No** |
| `rejected` · `low_quality` | retake the photo only | Retake photo | Yes |
| `rejected` · `no_match` | full new session | Start over | Yes |
| `rejected` · `policy` | not retryable | — | Yes |

A transport failure never judged the user, so it neither burns an attempt nor
discards a perfectly good frame.

**The camera stays live during `verifying`.** A `low_quality` retry produces a
second photo without re-running the challenges, so face tracking has to remain
unbroken across the backend call — otherwise the retry becomes exactly the swap
window `continuityGuard` exists to close. `maxCaptureRetries` caps how many
photos one liveness proof can yield.

> ### `maxAttempts` is a UX affordance, not a security control
>
> An attacker submitting faces in bulk calls your API directly and never renders
> this component. **Real rate limiting must be server-side**, keyed on the
> `sessionId` in the payload — it is stable across capture-only retries and
> regenerated on a full restart, precisely so it can be that key.

---

## Capture quality

`frame.quality` carries the full record for every gated capture — send it with
the photo so a backend rejection can be attributed to capture conditions rather
than to the face:

```ts
frame.quality // → {
  //   pose: { yawDeg, pitchDeg, rollDeg, source },
  //   geometry: { box, centerOffset, eyeSpan },
  //   image: { sharpness, sharpnessScore, brightness, underexposed, overexposed },
  //   faceCount, eyeBlink, jawOpen, smile, poseJitterDeg,
  //   score, passedGates, failures: [{ gate, message, value, limit }]
  // }
```

Gates run in priority order, so `failures[0]` is the most useful thing to tell
the user — that's what drives the on-screen nudge ("Move closer", "Hold still").

### Calibrating thresholds

`DEFAULT_CAPTURE_GATES` was measured on a MacBook built-in camera at 640×480.
Sharpness and brightness are sensor-dependent, so treat them as a starting point:

```bash
npm run calibrate   # → http://127.0.0.1:8000
```

Record each scenario and paste the emitted constants back into source. The
harness validates that each sample actually moved the metric it claims to, and
refuses to emit thresholds from a run that didn't.

---

## Self-hosting the MediaPipe assets

By default the WASM binaries load from jsDelivr and the model from Google's CDN.
For CSP-restricted, air-gapped or offline deployments, copy
`node_modules/@mediapipe/tasks-vision/wasm` into your static assets:

```tsx
useFaceLandmarker(videoRef, {
  wasmBasePath: '/static/mediapipe/wasm',
  modelAssetPath: '/static/mediapipe/face_landmarker.task',
});
```

The JS glue and WASM binary must be the **same version** — mismatched pairs fail
in obscure ways. `MEDIAPIPE_WASM_VERSION` is exported so you can assert on it.

---

## Next.js App Router

No `<Script>` tags needed. The package uses dynamic `import('@mediapipe/tasks-vision')` internally.
Add `'use client'` to any component that renders `<LivenessCheck />`.

```tsx
// app/liveness/page.tsx
'use client';
import { LivenessCheck } from '@kloudlot/react-liveness';
export default function Page() {
  return <LivenessCheck onComplete={console.log} />;
}
```

---

## Compatibility

| Platform | Status |
|---|---|
| Chrome / Edge (desktop) | ✅ GPU accelerated |
| Firefox (desktop) | ✅ CPU fallback |
| Mobile Chrome Android | ✅ CPU fallback |
| Mobile Safari iOS | ✅ CPU fallback |
| React Native WebView | ✅ (grant camera permission before opening) |

---

## Building

```bash
npm install
npm run build       # outputs to dist/
npm run dev         # watch mode
npm run typecheck   # library + dev harnesses
npm run playground  # dev pages, see below
```

### Dev pages

`npm run playground` serves two pages on `127.0.0.1:8000` (neither is published):

- `/` — threshold calibration harness
- `/demo.html` — full session playground with a simulated backend, so every
  verdict branch (`low_quality`, `no_match`, `policy`, `error`, thrown) is
  reachable without a real API

## Publishing

```bash
# Update name in package.json first
npm publish --access public
```