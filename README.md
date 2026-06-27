# @kloudlot/react-liveness

Headless React liveness check component using MediaPipe Face Landmarker.
Works in Next.js (App Router), Vite, and any React 18+ project.
No CDN script tags. No global pollution. GPU/CPU auto-detected per device.

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
      onComplete={(passed, results, frame) => {
        if (passed && frame) {
          // Upload photo to your backend
          frame.blob().then((blob) => {
            const fd = new FormData();
            fd.append('photo', blob, 'liveness.jpg');
            fd.append('results', JSON.stringify(results));
            fetch('/api/attendance/verify', { method: 'POST', body: fd });
          });
        }
      }}
    />
  );
}
```

---

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `onComplete` | `(passed, results, frame?) => void` | — | Called when session ends |
| `theme` | `LivenessTheme` | — | High-level color theming (primary, success, danger, surface, text, etc.) |
| `styles` | `LivenessStyles` | — | Overrides for specific internal DOM elements |
| `className` | `string` | — | CSS class on the root container |
| `numberOfChallenge` | `number` | `3` | How many challenges to present to the user |
| `challengePool` | `Challenge[]` | Default set | Override the pool of challenges to pick from |

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
    onResult: ({ blendshapes, faceDetected, landmarks }) => {
      // your detection logic here
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
| `headYaw` | Head turn (positive = left on screen, negative = right) |
| `headNod` | Head nod (synthesised from noseTip.y sliding window) |

Full list: [MediaPipe Face Landmarker blendshapes](https://developers.google.com/mediapipe/solutions/vision/face_landmarker)

---

## Capturing the photo

When a session passes, `onComplete` receives a `CapturedFrame`:

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
npm run build   # outputs to dist/
npm run dev     # watch mode
```

## Publishing

```bash
# Update name in package.json first
npm publish --access public
```