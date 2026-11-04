import { describe, it, expect } from 'vitest';
import { generateSky } from './sky';

const SEEDS = [1, 2, 42, 1234, 99999, 123456789];

describe('generateSky', () => {
  it('is deterministic for the same seed', () => {
    expect(generateSky(42)).toEqual(generateSky(42));
  });

  it('produces different skies for different seeds', () => {
    expect(generateSky(1)).not.toEqual(generateSky(2));
  });

  it('records the seed', () => {
    expect(generateSky(777).seed).toBe(777);
  });

  it('has 45-60 stars', () => {
    for (const seed of SEEDS) {
      const { stars } = generateSky(seed);
      expect(stars.length).toBeGreaterThanOrEqual(45);
      expect(stars.length).toBeLessThanOrEqual(60);
    }
  });

  it('keeps stars within normalised bounds', () => {
    for (const seed of SEEDS) {
      for (const s of generateSky(seed).stars) {
        expect(s.x).toBeGreaterThanOrEqual(0.05);
        expect(s.x).toBeLessThanOrEqual(0.95);
        expect(s.y).toBeGreaterThanOrEqual(0.08);
        expect(s.y).toBeLessThanOrEqual(0.92);
      }
    }
  });

  it('keeps a minimum pairwise distance of 0.07', () => {
    for (const seed of SEEDS) {
      const { stars } = generateSky(seed);
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
          expect(d).toBeGreaterThanOrEqual(0.07);
        }
      }
    }
  });

  it('assigns sequential ids 0..n-1', () => {
    const { stars } = generateSky(5);
    stars.forEach((s, i) => expect(s.id).toBe(i));
  });

  it('gives integer brightness in 1..5', () => {
    for (const seed of SEEDS) {
      for (const s of generateSky(seed).stars) {
        expect(Number.isInteger(s.brightness)).toBe(true);
        expect(s.brightness).toBeGreaterThanOrEqual(1);
        expect(s.brightness).toBeLessThanOrEqual(5);
      }
    }
  });

  it('guarantees at least 4 stars of brightness >= 4', () => {
    for (const seed of SEEDS) {
      const bright = generateSky(seed).stars.filter((s) => s.brightness >= 4);
      expect(bright.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('is weighted toward dim stars', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      for (const s of generateSky(seed).stars) counts[s.brightness - 1]++;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[0] / total).toBeGreaterThan(0.3);
  });
});
