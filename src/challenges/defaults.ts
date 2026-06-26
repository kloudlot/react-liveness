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
 * Pick `count` challenges at random from the provided pool.
 * Defaults to DEFAULT_CHALLENGES if no pool is provided.
 */
export function pickChallenges(count = 3, pool: Challenge[] = DEFAULT_CHALLENGES): Challenge[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}