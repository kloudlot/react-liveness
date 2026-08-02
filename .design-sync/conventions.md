## @kloudlot/react-liveness — build conventions

This package ships **one** component, `LivenessCheck` — a self-contained biometric liveness-check card (camera preview, challenge prompts, pass/fail result), styled dark with a mint accent by default. No provider or root wrapper is required; just import and render:

```tsx
import { LivenessCheck } from '@kloudlot/react-liveness';

<LivenessCheck
  orgLabel="Marham HQ"
  employeeName="Ava Restrepo"
  employeeId="Emp #4821"
  onComplete={(passed, results, frame) => { /* handle result */ }}
/>
```

### Styling idiom: no CSS classes — style via the `theme` and `styles` props

This DS ships **no stylesheet**. Every visual is inline `style={}`, driven by two props on `LivenessCheck`:

- **`theme`** (`LivenessTheme`) — 8 color roles, the primary lever for on-brand output: `primary` (default mint `#6ee7c4`), `success`, `danger` (default coral `#ff8f73`), `warning`, `background` (default near-black `#0c0e13`), `surface`, `text` (default off-white `#f4f7f5`), `border`. These map to CSS custom properties (`--live-primary`, etc.) applied at the component root and read throughout — including the circular progress ring around the camera.
- **`styles`** (`LivenessStyles`) — deep per-region style overrides (each a `React.CSSProperties` object) for fine control beyond color: `root`, `header`, `titleGroup`, `statusDot`, `title`, `subtitle`, `secureBadge`, `errorBanner`, `cameraShell`, `cameraFrame`, `video`, `faceGuide`, `liveBadge`, `idleOverlay`, `loadingOverlay`, `resultOverlay`, `warningPill`, `capturedThumb`, `stepIndicator`, `stepDot`, `stepDotActive`, `stepCounter`, `cuePill`, `cueDot`, `cueText`, `cancelLink`, `instructionCard`, `instructionIcon`, `instructionText`, `actionWrapper`, `actionButton`, `resultList`, `resultPill`, `identityRow`, `fallbackLink`.

Never invent a `className` API or external stylesheet for this component — there isn't one. All customization goes through `theme` (colors) and `styles` (layout/spacing/typography per region).

### Typography
The component sets its own font stack (`Space Grotesk` for body/headings, `Space Mono` for labels/counters/badges) and loads both from Google Fonts at runtime via an injected `<style>` tag — no host-app font setup required, but it does mean a network fetch on first render. Fonts fall back to `system-ui`/`ui-monospace` until loaded.

### Other props
- `numberOfChallenge` (default 3) / `challengePool` — control the verification flow, not appearance.
- `orgLabel` (default `"Secure"`) — text in the header badge; use for a company/location name.
- `employeeName` / `employeeId` — optional identity strip shown on the success/failure screens once the session ends.
- `onCancel` — called when the user taps "Cancel" mid-session; defaults to resetting the component if omitted.
- `onFallback` — called when the user taps "Verify with a supervisor instead" on a failed session. **This link only renders when `onFallback` is provided** — omit the prop to hide it entirely.
- `onComplete(passed, results, frame)` — fires when the session ends.

### Where the truth lives
The component's full prop surface is in `LivenessCheck.d.ts` in this bundle. There is no separate CSS file to read — `styles.css` here is a runtime-styling stub by design (CSS-in-JS).

### Behavioral note
`LivenessCheck` only renders its **idle** state (camera-permission prompt, progress ring at 0%) until a real camera + face are present — the challenge/result states, the filled progress ring, and the step-dot indicator are runtime-only and not something a static composition can show. Build with it as the request-permission entry point of a verification flow, not as a component with visual "variants" to pick from.
