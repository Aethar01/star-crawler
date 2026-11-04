import type { Rng } from './types';

export interface DiceExpr {
  count: number;
  sides: number;
  bonus: number;
}

/**
 * Parses "1d8", "2d4+1", "1d6-1", "d8" (count defaults to 1) or a flat "3".
 * Flat numbers parse as { count: 0, sides: 0, bonus: n }.
 */
export function parseDice(expr: string): DiceExpr {
  const s = expr.replace(/\s+/g, '');

  if (/^[+-]?\d+$/.test(s)) {
    return { count: 0, sides: 0, bonus: parseInt(s, 10) };
  }

  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(s);
  if (!m) throw new Error(`Invalid dice expression: "${expr}"`);

  const sides = parseInt(m[2], 10);
  if (sides < 1) throw new Error(`Invalid dice expression: "${expr}"`);

  return {
    count: m[1] === '' ? 1 : parseInt(m[1], 10),
    sides,
    bonus: m[3] ? parseInt(m[3], 10) : 0,
  };
}

/** Rolls a dice expression. crit doubles the dice count (not the bonus). Result is never negative. */
export function rollDice(expr: string, rng: Rng, crit = false): number {
  const { count, sides, bonus } = parseDice(expr);
  const dice = crit ? count * 2 : count;
  let total = bonus;
  for (let i = 0; i < dice; i++) total += rng.int(1, sides);
  return Math.max(0, total);
}

/** Rolls a d20. Advantage takes the higher of two rolls, disadvantage the lower. */
export function rollD20(rng: Rng, mode: 'normal' | 'advantage' | 'disadvantage' = 'normal'): number {
  const a = rng.int(1, 20);
  if (mode === 'normal') return a;
  const b = rng.int(1, 20);
  return mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
}
