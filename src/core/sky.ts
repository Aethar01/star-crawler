import type { Sky, Star } from './types';
import { createRng } from './rng';

const MIN_COUNT = 45;
const MAX_COUNT = 60;
const MIN_SPACING = 0.07;
const MAX_ATTEMPTS_PER_STAR = 200;
const X_RANGE: [number, number] = [0.05, 0.95];
const Y_RANGE: [number, number] = [0.08, 0.92];
const MIN_BRIGHT_STARS = 4;
const MIN_BRIGHT = 4;

/** Cumulative weights for brightness 1..5 (40/25/18/11/6). */
const BRIGHTNESS_WEIGHTS = [40, 25, 18, 11, 6];
const BRIGHTNESS_TOTAL = BRIGHTNESS_WEIGHTS.reduce((a, b) => a + b, 0);

function pickBrightness(r: number): number {
  let acc = 0;
  const target = r * BRIGHTNESS_TOTAL;
  for (let i = 0; i < BRIGHTNESS_WEIGHTS.length; i++) {
    acc += BRIGHTNESS_WEIGHTS[i];
    if (target < acc) return i + 1;
  }
  return BRIGHTNESS_WEIGHTS.length;
}

/** Deterministic star field for a seed. Same seed always yields the same sky. */
export function generateSky(seed: number): Sky {
  const rng = createRng(seed);
  const target = rng.int(MIN_COUNT, MAX_COUNT);
  const stars: Star[] = [];

  const minDistSq = MIN_SPACING * MIN_SPACING;
  const budget = target * MAX_ATTEMPTS_PER_STAR;
  let attempts = 0;

  while (stars.length < target && attempts < budget) {
    attempts++;
    const x = X_RANGE[0] + rng.next() * (X_RANGE[1] - X_RANGE[0]);
    const y = Y_RANGE[0] + rng.next() * (Y_RANGE[1] - Y_RANGE[0]);
    const tooClose = stars.some((s) => {
      const dx = s.x - x;
      const dy = s.y - y;
      return dx * dx + dy * dy < minDistSq;
    });
    if (tooClose) continue;
    stars.push({ id: stars.length, x, y, brightness: pickBrightness(rng.next()) });
  }

  // Guarantee at least MIN_BRIGHT_STARS stars of brightness >= MIN_BRIGHT.
  let bright = stars.filter((s) => s.brightness >= MIN_BRIGHT).length;
  while (bright < MIN_BRIGHT_STARS) {
    const dim = stars.filter((s) => s.brightness < MIN_BRIGHT);
    if (dim.length === 0) break;
    const star = rng.pick(dim);
    star.brightness = MIN_BRIGHT;
    bright++;
  }

  return { seed, stars };
}
