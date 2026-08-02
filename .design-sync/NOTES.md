# design-sync notes — react-liveness

## Repo shape
- No Storybook, no `*.stories.*` files anywhere in the repo — package shape confirmed with the user.
- Public API surface (via `dist/index.d.ts`) exports exactly **one** component: `LivenessCheck`. `ChallengeSteps` and `FaceOverlay` (`src/components/`) are internal implementation detail, not exported from `src/index.ts` — excluded from the sync per user decision (2026-08-02).
- No shipped CSS anywhere (`src/`, `dist/`) — `LivenessCheck` styles itself entirely via inline `style={}` with CSS custom properties (`--live-*`) driven by the `theme` prop. This is the `[CSS_RUNTIME]` case; expected and non-blocking.

## Component state machine — camera/MediaPipe dependency
`LivenessCheck`'s visible state (`idle` → `waiting` → `detecting` → `complete`/`failed`) is entirely internal, driven by `useCamera` (`getUserMedia`) and `useFaceLandmarker` (MediaPipe wasm model). There is no prop to force a non-idle state.
- In the design-sync render check (headless Chromium, no camera permission), the component renders its **idle** state only — and it renders fully styled (header, secure badge, camera panel, CTA). This is the true initial render, not a fallback.
- The `detecting`/`complete`/`failed` states (challenge pills, instruction card, result overlay) can **never** be captured by a static preview — they require a live camera + a real face performing challenges. Anyone building with this DS in Claude Design should expect only the idle state to be visible in the picker.

## Known render warns
- `CustomChallengeCount` and `Default` preview cells render **visually identical** — expected, not a bug. `numberOfChallenge` only changes challenge-flow behavior reachable after `startCamera()` succeeds, which the idle-state-only static render never reaches. Do not chase a "variants render identically" flag on this component in future re-syncs.

## Preview authored
`.design-sync/previews/LivenessCheck.tsx` — 3 exports: `Default`, `BrandTheme` (sweeps the `theme` prop — the only prop with a static-visible effect), `CustomChallengeCount` (documents the API even though it's not visually distinguishable here).

## 2026-08-02 — visual redesign to match the "Attest" reference design
The user shared an existing Claude Design mockup ("Attest liveness verification flow", a `PROJECT_TYPE_PROJECT`, not a design-system project — read via `get_file` on `Liveness Verification.dc.html`) and asked for `LivenessCheck`'s actual look to be updated to match it, made the new default (not an opt-in preset). Implemented in `src/components/LivenessCheck.tsx`:
- Dark theme by default: bg `#0c0e13`, mint primary `#6ee7c4`, coral danger/warning `#ff8f73`, off-white text `#f4f7f5`.
- Circular camera frame (was rounded-rect) wrapped in an SVG progress ring (was a linear bar) — ring fraction: 0 idle/waiting, live per-challenge progress while detecting, full on success, `results.length / challenges.length` on failure.
- Step indicator changed from icon pills to dot+pill markers with an "N / M" counter (`Space Mono`).
- Added `Space Grotesk` (body/headings) + `Space Mono` (labels) loaded via a runtime `@import` in the component's injected `<style>` tag — **this is invisible to the static font scrape** (`[FONT_MISSING]` never fires because the import isn't in any scraped stylesheet, only in runtime JS). Not a gap to chase; same CSS-in-JS pattern as the rest of the component's styling. Renders will use fallback fonts (`system-ui`/`ui-monospace`) until the Google Fonts request resolves.
- New props to close feature gaps the mockup implied: `orgLabel` (header badge text, default `"Secure"`), `employeeName`/`employeeId` (optional identity row on done screens), `onCancel` (Cancel link mid-session), `onFallback` (supervisor-fallback link on failure — link only renders if this prop is passed).
- Fixed a pre-existing bug found while editing: `src/index.ts` re-exported a stale `LivenessCheckProps` from `src/types/index.ts` (had `challenges`/`challengeCount`/`muted` — fields the component never accepted) instead of the component's real props (`theme`/`styles`/`numberOfChallenge`/`challengePool`/etc.). Removed the stale duplicate from `types/index.ts`; `src/index.ts` now exports `LivenessCheckProps`/`LivenessTheme`/`LivenessStyles` from `./components/LivenessCheck` directly. This also means the design-sync bundle's `.d.ts` (which was already reading the component's real inline type via ts-morph, not the barrel export) was accurate even before the fix — only the *package's own* public export was wrong.
- Re-authored `.design-sync/conventions.md` and `.design-sync/previews/LivenessCheck.tsx` for the new defaults/props; re-graded all 3 cells `good`.

## Re-sync risks
- If a future version of `LivenessCheck` adds a prop to force/preview a given `status` (e.g. `initialStatus` for storybook/demo purposes), revisit the preview to add `Detecting`/`Complete`/`Failed` exports — much richer than what's possible today.
- If `ChallengeSteps`/`FaceOverlay` are ever exported from `src/index.ts`, they should be added to the sync (currently excluded only because they're not part of the public API).
- No Playwright/Chromium was installed in this environment before this sync; it was installed fresh into the global playwright cache — a future clone/CI run needs to install it again (see base SKILL.md §4.1).
- The Google Fonts `@import` is runtime-only (see above) — if this DS ever ships a static stylesheet, move the font-face declarations there so the design-sync font scrape can actually verify them instead of this being a standing blind spot.
