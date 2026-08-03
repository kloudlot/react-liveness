import { Challenge } from '../types';

/**
 * headYaw is computed as: noseTip.x − centerX (MediaPipe unmirrored space).
 * The video renders mirrored (scaleX(-1)), so:
 *   User turns LEFT  on screen → positive headYaw
 *   User turns RIGHT on screen → negative headYaw
 *
 * headNod is a synthetic key: range of noseTip.y over a 15-frame sliding
 * window. A natural nod produces ~0.015–0.025 in normalised coords.
 */
export const DEFAULT_CHALLENGES: Challenge[] = [
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
    type: 'TURN_LEFT',
    label: 'Turn Left',
    instruction: 'Turn your head to the left',
    icon: '👈',
    timeoutMs: 6000,
    blendshapes: [{ key: 'headYaw', threshold: 0.06 }],
  },
  {
    type: 'TURN_RIGHT',
    label: 'Turn Right',
    instruction: 'Turn your head to the right',
    icon: '👉',
    timeoutMs: 6000,
    blendshapes: [{ key: 'headYaw', threshold: -0.06 }],
  },
  {
    type: 'OPEN_MOUTH',
    label: 'Open Mouth',
    instruction: 'Open your mouth wide',
    icon: '😮',
    timeoutMs: 5000,
    blendshapes: [{ key: 'jawOpen', threshold: 0.4 }],
  },
  {
    type: 'NOD',
    label: 'Nod',
    instruction: 'Nod your head up and down',
    icon: '🙆',
    timeoutMs: 7000,
    blendshapes: [{ key: 'headNod', threshold: 0.018 }],
  },
];

/**
 * An explicit "look straight ahead" step, using the degree-based pose keys.
 *
 * Deliberately NOT in DEFAULT_CHALLENGES: holding still is not proof of life,
 * so counting it as a liveness challenge would overstate what a passing session
 * demonstrates. Most people want the capture gate (`captureMode:
 * 'centeredFace'`), which runs every session and picks the best frame rather
 * than the first qualifying one. Use this only if you specifically want
 * centring to appear as a numbered step in the sequence.
 *
 * Gates yaw and roll only. Pitch carries a large device-dependent offset — the
 * camera's height relative to the face — so an absolute pitch band would behave
 * differently on a laptop than on a phone. The capture gate handles pitch
 * properly by measuring against a per-session baseline.
 */
export const CENTER_FACE_CHALLENGE: Challenge = {
  type: 'CENTER_FACE',
  label: 'Look straight',
  instruction: 'Look straight at the camera',
  icon: '🎯',
  timeoutMs: 6000,
  blendshapes: [
    { key: 'headYawDeg', threshold: 12, compare: 'absBelow' },
    { key: 'headRollDeg', threshold: 10, compare: 'absBelow' },
  ],
};

/**
 * Pick `count` challenges at random from the provided pool.
 * Defaults to DEFAULT_CHALLENGES if no pool is provided.
 */
export function pickChallenges(count = 3, pool: Challenge[] = DEFAULT_CHALLENGES): Challenge[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}