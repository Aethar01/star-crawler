import { describe, expect, it } from 'vitest';
import { THEME_INFO, recognizeConstellation, validateConstellation } from './constellations';
import type { Constellation, Sky, ThemeId } from './types';

type Pt = [number, number];
type Edge = [number, number];

/** Build a sky and constellation from explicit coords. Star i gets id idOf(i). */
function make(points: Pt[], edges: Edge[], idOf: (i: number) => number = (i) => i) {
  const sky: Sky = {
    seed: 0,
    stars: points.map(([x, y], i) => ({ id: idOf(i), x, y, brightness: 3 })),
  };
  const c: Constellation = {
    starIds: points.map((_, i) => idOf(i)),
    edges: edges.map(([a, b]): Edge => [idOf(a), idOf(b)]),
  };
  return { sky, c };
}

const pathEdges = (n: number): Edge[] => Array.from({ length: n - 1 }, (_, i): Edge => [i, i + 1]);

// Winding S-curve, tall: turns flip direction at every vertex.
const SERPENT: Pt[] = [[0.2, 0.1], [0.8, 0.2], [0.2, 0.4], [0.8, 0.6], [0.2, 0.8], [0.6, 0.95]];
// Wide, flat row of five peaks: regular alternation, aspect 3.
const CROWN: Pt[] = [[0.05, 0.6], [0.2, 0.3], [0.35, 0.6], [0.5, 0.3], [0.65, 0.6], [0.8, 0.3], [0.95, 0.6]];
// Body (0,1) with two legs/heads on each end.
const HOUND: Pt[] = [[0.3, 0.5], [0.6, 0.5], [0.2, 0.3], [0.2, 0.7], [0.7, 0.3], [0.7, 0.7]];
const HOUND_E: Edge[] = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5]];
// Hub at centre with a straight shaft (left-right) and a third arm up, tail further up.
const ARCHER: Pt[] = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.05]];
const ARCHER_E: Edge[] = [[0, 1], [0, 2], [0, 3], [3, 4]];
// Square cup (0-3) with a stem of two stars hanging below from corner 3.
const CHALICE: Pt[] = [[0.35, 0.2], [0.65, 0.2], [0.65, 0.4], [0.35, 0.4], [0.35, 0.6], [0.35, 0.8]];
const CHALICE_E: Edge[] = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5]];
// Two unit squares sharing an edge (1-2): cyclomatic number 2.
const TWO_SQUARES: Pt[] = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3], [0.5, 0.1], [0.5, 0.3]];
const TWO_SQUARES_E: Edge[] = [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5], [5, 2]];

const EXAMPLES: Array<[string, Pt[], Edge[], ThemeId]> = [
  ['serpent', SERPENT, pathEdges(SERPENT.length), 'serpent'],
  ['crown', CROWN, pathEdges(CROWN.length), 'crown'],
  ['hound', HOUND, HOUND_E, 'hound'],
  ['archer', ARCHER, ARCHER_E, 'archer'],
  ['chalice', CHALICE, CHALICE_E, 'chalice'],
];

describe('validateConstellation', () => {
  it('accepts a connected drawing within limits', () => {
    const { sky, c } = make(SERPENT, pathEdges(SERPENT.length));
    expect(validateConstellation(sky, c)).toEqual({ ok: true });
  });

  it('rejects too few stars', () => {
    const tri: Pt[] = [[0, 0], [1, 0], [0, 1]];
    const { sky, c } = make(tri, [[0, 1], [1, 2], [2, 0]]);
    expect(validateConstellation(sky, c).ok).toBe(false);
  });

  it('rejects too many stars', () => {
    const pts: Pt[] = Array.from({ length: 11 }, (_, i): Pt => [i / 10, (i % 3) / 3]);
    const { sky, c } = make(pts, pathEdges(11));
    const res = validateConstellation(sky, c);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/too many/);
  });

  it('rejects a disconnected graph', () => {
    const pts: Pt[] = [[0, 0], [0.1, 0], [0.5, 0.5], [0.6, 0.5]];
    const { sky, c } = make(pts, [[0, 1], [2, 3]]);
    const res = validateConstellation(sky, c);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not connected/);
  });

  it('rejects a duplicate edge (in either orientation)', () => {
    const { sky, c } = make(SERPENT.slice(0, 4), [[0, 1], [1, 2], [2, 3], [1, 0]]);
    const res = validateConstellation(sky, c);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/duplicate edge/);
  });

  it('rejects self-loops and edges to stars outside starIds', () => {
    const a = make(SERPENT.slice(0, 4), [[0, 1], [1, 2], [2, 3], [2, 2]]);
    expect(validateConstellation(a.sky, a.c).ok).toBe(false);
    const b = make(SERPENT.slice(0, 4), [[0, 1], [1, 2], [2, 3], [3, 9]]);
    expect(validateConstellation(b.sky, b.c).ok).toBe(false);
  });
});

describe('recognizeConstellation: example shapes', () => {
  it.each(EXAMPLES)('recognises %s', (_label, pts, edges, theme) => {
    const { sky, c } = make(pts, edges);
    const m = recognizeConstellation(sky, c);
    expect(m.theme).toBe(theme);
    expect(m.name).toBe(THEME_INFO[theme].name);
    expect(m.score).toBeGreaterThanOrEqual(0.5);
  });

  it('two squares sharing an edge is unnamed', () => {
    const { sky, c } = make(TWO_SQUARES, TWO_SQUARES_E);
    const m = recognizeConstellation(sky, c);
    expect(m.theme).toBe('unnamed');
    expect(m.name).toBe(THEME_INFO.unnamed.name);
    expect(m.score).toBeLessThan(0.5);
  });

  it('a straight line is unnamed', () => {
    const pts: Pt[] = [[0.1, 0.5], [0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.9, 0.5]];
    const { sky, c } = make(pts, pathEdges(5));
    expect(recognizeConstellation(sky, c).theme).toBe('unnamed');
  });

  it('invalid input is unnamed with score 0', () => {
    const pts: Pt[] = [[0, 0], [0.1, 0], [0.5, 0.5], [0.6, 0.5]];
    const { sky, c } = make(pts, [[0, 1], [2, 3]]);
    expect(recognizeConstellation(sky, c)).toEqual({
      theme: 'unnamed',
      name: THEME_INFO.unnamed.name,
      score: 0,
    });
  });
});

describe('recognizeConstellation: invariances', () => {
  const all: Array<[string, Pt[], Edge[]]> = [
    ...EXAMPLES.map(([label, pts, edges]): [string, Pt[], Edge[]] => [label, pts, edges]),
    ['two squares', TWO_SQUARES, TWO_SQUARES_E],
  ];

  it.each(all)('%s: edge order and star id relabelling do not change the result', (_label, pts, edges) => {
    const base = make(pts, edges);
    const expected = recognizeConstellation(base.sky, base.c);

    // Reverse the edge list and flip each pair; relabel ids; reverse starIds order.
    const shuffled = edges.map(([a, b]): Edge => [b, a]).reverse();
    const relabelled = make(pts, shuffled, (i) => (i * 37 + 11) % 97);
    relabelled.c.starIds.reverse();
    const got = recognizeConstellation(relabelled.sky, relabelled.c);

    expect(got.theme).toBe(expected.theme);
    expect(got.name).toBe(expected.name);
    expect(got.score).toBeCloseTo(expected.score, 10);
  });

  it.each(all)('%s: uniform scale and translation do not change the result', (_label, pts, edges) => {
    const base = make(pts, edges);
    const expected = recognizeConstellation(base.sky, base.c);

    const moved: Pt[] = pts.map(([x, y]): Pt => [0.1 + 0.6 * x, 0.15 + 0.6 * y]);
    const scaled = make(moved, edges);
    const got = recognizeConstellation(scaled.sky, scaled.c);

    expect(got.theme).toBe(expected.theme);
    expect(got.score).toBeCloseTo(expected.score, 10);
  });
});
