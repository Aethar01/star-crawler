import { describe, it, expect } from 'vitest';
import type { Rng } from './types';
import { createRng } from './rng';
import { parseDice, rollDice, rollD20 } from './dice';

/** Rng that returns scripted int() values in order and fails on over-draw or out-of-range values. */
function scripted(values: number[]): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: (min, max) => {
      const v = values[i++];
      if (v === undefined) throw new Error('scripted rng exhausted');
      if (v < min || v > max) throw new Error(`scripted ${v} outside [${min}, ${max}]`);
      return v;
    },
    pick: (items) => items[0],
  };
}

describe('parseDice', () => {
  it('parses NdS', () => {
    expect(parseDice('1d8')).toEqual({ count: 1, sides: 8, bonus: 0 });
  });

  it('parses NdS+B and NdS-B', () => {
    expect(parseDice('2d4+1')).toEqual({ count: 2, sides: 4, bonus: 1 });
    expect(parseDice('1d6-1')).toEqual({ count: 1, sides: 6, bonus: -1 });
  });

  it('parses a flat number as bonus only', () => {
    expect(parseDice('3')).toEqual({ count: 0, sides: 0, bonus: 3 });
  });

  it('defaults count to 1 when omitted', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, bonus: 0 });
  });

  it('throws on invalid expressions', () => {
    expect(() => parseDice('1d')).toThrow();
    expect(() => parseDice('abc')).toThrow();
    expect(() => parseDice('1d0')).toThrow();
  });
});

describe('rollDice', () => {
  it('sums dice and adds the bonus', () => {
    expect(rollDice('2d4+1', scripted([2, 4]))).toBe(7);
  });

  it('returns the flat bonus without drawing randomness', () => {
    expect(rollDice('3', scripted([]))).toBe(3);
  });

  it('crit doubles the dice count but not the bonus', () => {
    // 1d6+2 on crit rolls two d6: 3 + 4 + 2 = 9
    expect(rollDice('1d6+2', scripted([3, 4]), true)).toBe(9);
  });

  it('crit on a flat expression adds nothing extra', () => {
    expect(rollDice('3', scripted([]), true)).toBe(3);
  });

  it('never returns less than 0', () => {
    expect(rollDice('1d4-5', scripted([1]))).toBe(0);
  });

  it('stays within bounds over many seeded rolls', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const v = rollDice('2d6+1', rng);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(13);
    }
  });
});

describe('rollD20', () => {
  it('returns a single roll in normal mode', () => {
    expect(rollD20(scripted([13]))).toBe(13);
  });

  it('advantage takes the higher roll', () => {
    expect(rollD20(scripted([5, 15]), 'advantage')).toBe(15);
  });

  it('disadvantage takes the lower roll', () => {
    expect(rollD20(scripted([5, 15]), 'disadvantage')).toBe(5);
  });
});
