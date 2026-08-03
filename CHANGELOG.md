# Changelog

## 1.1.0

Liveness sessions now produce a photo worth comparing, and stop claiming
"verified" on their own authority.

### The problem this release fixes

Up to 1.0.3 the photo was captured the instant the last challenge resolved —
whatever pose the user happened to be in. That is systematically the worst frame
of the session:

| Final challenge | Captured photo |
|---|---|
| `TURN_LEFT` / `TURN_RIGHT` | profile shot |
| `BLINK` | eyes closed (it fires on `eyeBlink > 0.5`) |
| `OPEN_MOUTH` / `SMILE` | heavy expression distortion |
| `NOD` | mid-pitch, motion blurred |

Roughly a third of sessions returned a profile or closed-eye photo to compare
against an enrolment image.

### Added

- **Frontal capture gate** (`captureMode: 'centeredFace'`, the new default).
  After the challenges, waits for a frame that is frontal, centred, sharp,
  well-lit, eyes-open and stable, and keeps the *best* one seen rather than the
  first that qualifies.
- **Head pose derivation** — `derivePose`, `deriveGeometry`, `poseFromMatrix`,
  `poseFromLandmarks`. Enables `outputFacialTransformationMatrixes` and
  decomposes it to yaw/pitch/roll in degrees, with a landmark fallback.
- **Frame quality measurement** — `measureFrameQuality`: variance-of-Laplacian
  sharpness plus exposure statistics.
- **Gate policy** — `evaluateGates`, `DEFAULT_CAPTURE_GATES`. Pure and
  DOM-free, so accept/reject policy is testable without a camera.
- **Backend verification** — `onVerify`, `onSettled`, `maxAttempts`,
  `verifyTimeoutMs`, `maxCaptureRetries`. The session shows "verified" only
  after your backend says so.
- **Align phase** (`alignPhase`, default on) — a short framing step before the
  challenges. Establishes the per-device pitch baseline and yields a second
  frontal frame for same-person continuity checks.
- **Tracking continuity guard** (`continuityGuard`, default on) — fails the
  session if face tracking drops between the challenges and the photo, closing
  the window where an attacker passes the challenges live and then presents a
  photo of someone else.
- **Multi-face detection** — `numFaces` now defaults to `2`, so a second person
  in frame is *detected* rather than silently ignored. `pickPrimaryFace` selects
  the largest face; previously index `0` was used blindly, which let a
  background face drive the session.
- **`compare` on `BlendshapeCondition`** — `'above' | 'below' | 'absBelow' |
  'absAbove'`. The old rule inferred direction from the threshold's sign, which
  cannot express a band such as "within ±12°".
- **`CENTER_FACE_CHALLENGE`** — an explicit "look straight" step. Not in the
  default pool: holding still is not proof of life.
- **`FaceOverlay`** is now exported.
- **`wasmBasePath` / `modelAssetPath`** — self-host the MediaPipe assets. Needed
  for CSP-restricted, air-gapped and offline deployments.
- **Accessibility** — live region on the instruction headline, `role="alert"` on
  errors, labelled region and video, `prefers-reduced-motion` support.
- **`data-liveness-status`** on the root, for styling per phase.

### Changed

- **⚠ Google Fonts is no longer loaded automatically.** Set `loadFonts` to
  restore it, or self-host. It was an unannounced third-party request from an
  identity widget and it hard-fails under a strict CSP. The font stacks fall
  back to system fonts, so the layout is unaffected.
- **⚠ MediaPipe WASM is pinned to 0.10.35**, matching the peer-dependency floor.
  It was pinned to 0.10.14 while the floor was `>= 0.10.35`, so every consumer
  was running mismatched JS glue and WASM binaries.
- Gated captures are **not mirrored** (`frame.mirrored === false`). The
  canonical record for backend comparison should be true camera orientation.
  `captureFrame()` called directly still mirrors by default.
- `CapturedFrame` gains `mirrored` and an optional `quality` with the full pose,
  geometry, image and gate-failure record.
- Three terminal states instead of two: `failed` (liveness), `rejected`
  (backend said no) and `error` (backend unreachable). `error` is rendered in a
  warning tone rather than as a rejection.
- `ChallengeStatus` gains `aligning`, `capturing`, `verifying`, `rejected` and
  `error`. `LivenessStatus` is a clearer alias.

### Fixed

- **Uncancellable inter-challenge timeout.** The pause between challenges was
  never cancelled, so cancelling mid-pause still advanced the session and called
  `onComplete`, and unmounting set state on a dead component.
- **`CapturedFrame` was declared twice**, surfacing in the bundled `.d.ts` as
  `CapturedFrame$1` — two identical types TypeScript treated as distinct.

### Removed

- `ChallengeSteps` — unused, unexported, and superseded by the built-in step
  indicator.

### Migration

No changes required. `onComplete` keeps its signature and still fires when the
liveness stage resolves; `frame` is simply a better photo, now carrying
`frame.quality`.

To restore 1.0.x behaviour exactly:

```tsx
<LivenessCheck captureMode="onComplete" alignPhase={false} loadFonts />
```

### Calibration

Gate thresholds in `DEFAULT_CAPTURE_GATES` were measured on a MacBook built-in
camera at 640×480. They are a starting point, not a universal constant — sharpness
and brightness are sensor-dependent. Re-derive for your hardware with:

```bash
npm run calibrate
```
