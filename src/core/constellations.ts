import { MAX_STARS, MIN_STARS } from './types';
import type { Constellation, ConstellationMatch, Point, Sky, ThemeId } from './types';

export const THEME_INFO: Record<ThemeId, { name: string; description: string; hint: string }> = {
  serpent: {
    name: 'The Serpent',
    description: 'Coiled tunnels where the air hisses and the dead slough their skin in the dark.',
    hint: 'Draw a line that keeps doubling back on itself, winding like something that has never been still.',
  },
  crown: {
    name: 'The Crown',
    description: 'A frost-bound throne hall where a dead king still counts his tithe of skulls.',
    hint: 'Draw a wide, level row of sharp peaks, rising and falling like teeth along a horizon.',
  },
  hound: {
    name: 'The Hound',
    description: 'Iron kennels thick with rot, where something with too many heads waits to be loosed.',
    hint: 'Draw a compact body, then limbs and heads branching off it at both ends.',
  },
  archer: {
    name: 'The Archer',
    description: 'A ruined watchtower where an unseen bowstring hums, drawn for the kill.',
    hint: 'Draw a straight shaft through one central star, then fan a third line off that same star.',
  },
  chalice: {
    name: 'The Chalice',
    description: 'A sunken sanctum where a wraith drinks from a cup that never empties, then pours its dark down a stone stem.',
    hint: 'Draw a closed ring of stars for the cup, then a tail hanging well below it.',
  },
  unnamed: {
    name: 'The Nameless',
    description: 'Halls with no name, and whatever lives there has forgotten its own.',
    hint: 'Draw something the sky has no word for: several loops, or a tangle that matches nothing.',
  },
};

/** Best theme score must reach this to be named. */
const THRESHOLD = 0.5;
const EPS = 1e-9;
const THEMES = ['serpent', 'crown', 'hound', 'archer', 'chalice'] as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * Score = structure * (0.4 + 0.6 * shape).
 * `structure` is the hard rule (false = theme impossible, score 0). `shape` is graded geometry.
 * A structurally valid but geometrically flat drawing scores 0.4, below THRESHOLD, so it stays unnamed.
 */
const grade = (structure: boolean, shape: number): number =>
  structure ? 0.4 + 0.6 * clamp01(shape) : 0;

// ---------- Validation ----------

function buildAdjacency(c: Constellation): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const id of c.starIds) adj.set(id, []);
  for (const [a, b] of c.edges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  return adj;
}

function isConnected(ids: number[], adj: Map<number, number[]>): boolean {
  const seen = new Set<number>([ids[0]]);
  const stack = [ids[0]];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj.get(u) ?? []) {
      if (!seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    }
  }
  return seen.size === ids.length;
}

export function validateConstellation(sky: Sky, c: Constellation): { ok: boolean; reason?: string } {
  const n = c.starIds.length;
  if (n < MIN_STARS) return { ok: false, reason: `too few stars: ${n} < ${MIN_STARS}` };
  if (n > MAX_STARS) return { ok: false, reason: `too many stars: ${n} > ${MAX_STARS}` };

  const ids = new Set(c.starIds);
  if (ids.size !== n) return { ok: false, reason: 'duplicate star ids' };

  const skyIds = new Set(sky.stars.map((s) => s.id));
  for (const id of c.starIds) {
    if (!skyIds.has(id)) return { ok: false, reason: `star ${id} is not in the sky` };
  }

  const pairs = new Set<string>();
  for (const [a, b] of c.edges) {
    if (!ids.has(a) || !ids.has(b)) {
      return { ok: false, reason: `edge ${a}-${b} references a star not in starIds` };
    }
    if (a === b) return { ok: false, reason: `self-loop on star ${a}` };
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (pairs.has(key)) return { ok: false, reason: `duplicate edge ${key}` };
    pairs.add(key);
  }

  if (!isConnected(c.starIds, buildAdjacency(c))) return { ok: false, reason: 'graph is not connected' };
  return { ok: true };
}

// ---------- Features ----------

interface Analysis {
  ids: number[];
  V: number;
  /** independent cycles: E - V + 1 (graph is connected) */
  cycles: number;
  adj: Map<number, number[]>;
  degree: Map<number, number>;
  pos: Map<number, Point>;
  /** ids with degree >= 3 */
  branches: number[];
  isTree: boolean;
  /** ordered points along the path when the graph is a simple path, else null */
  path: Point[] | null;
  /** raw bbox width / height; invariant to uniform scale and translation */
  aspect: number;
  /** raw longest bbox side; used to normalise distances */
  scale: number;
}

/** Walk a simple path from one endpoint. Direction does not affect any feature used here. */
function orderPath(ids: number[], adj: Map<number, number[]>, pos: Map<number, Point>, degree: Map<number, number>): Point[] {
  const ends = ids
    .filter((id) => degree.get(id) === 1)
    .sort((a, b) => pos.get(a)!.x - pos.get(b)!.x || pos.get(a)!.y - pos.get(b)!.y);
  const out: Point[] = [];
  let prev = -1;
  let cur = ends[0];
  while (out.length < ids.length) {
    out.push(pos.get(cur)!);
    const next = adj.get(cur)!.find((v) => v !== prev);
    if (next === undefined) break;
    prev = cur;
    cur = next;
  }
  return out;
}

function analyse(sky: Sky, c: Constellation): Analysis {
  const byId = new Map(sky.stars.map((s) => [s.id, s] as const));
  const pos = new Map<number, Point>();
  for (const id of c.starIds) pos.set(id, { x: byId.get(id)!.x, y: byId.get(id)!.y });

  const adj = buildAdjacency(c);
  const degree = new Map<number, number>();
  for (const id of c.starIds) degree.set(id, adj.get(id)!.length);

  const V = c.starIds.length;
  const cycles = c.edges.length - V + 1;
  const isTree = cycles === 0;
  const maxDeg = Math.max(...c.starIds.map((id) => degree.get(id)!));
  const xs = c.starIds.map((id) => pos.get(id)!.x);
  const ys = c.starIds.map((id) => pos.get(id)!.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);

  return {
    ids: c.starIds,
    V,
    cycles,
    adj,
    degree,
    pos,
    branches: c.starIds.filter((id) => degree.get(id)! >= 3),
    isTree,
    path: isTree && maxDeg <= 2 ? orderPath(c.starIds, adj, pos, degree) : null,
    aspect: w / Math.max(h, EPS),
    scale: Math.max(w, h, EPS),
  };
}

/** Signed turn angle (radians, -PI..PI) at each interior vertex of an ordered polyline. */
function turnAngles(pts: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x;
    const by = pts[i + 1].y - pts[i].y;
    out.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  return out;
}

/** changes = number of direction flips between consecutive turns; regularity = changes / possible flips. */
function alternation(angles: number[]): { changes: number; regularity: number } {
  let changes = 0;
  for (let i = 1; i < angles.length; i++) {
    if ((angles[i] >= 0) !== (angles[i - 1] >= 0)) changes++;
  }
  return { changes, regularity: angles.length >= 2 ? changes / (angles.length - 1) : 0 };
}

/** path length / endpoint distance. 1 = straight, larger = more winding. */
function windingRatio(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len / Math.max(dist(pts[0], pts[pts.length - 1]), EPS);
}

/** Wide, flat, regular zigzag: 0 unless alternation is regular AND the bbox is >= ~1.5x wider than tall. */
function crownness(a: Analysis, angles: number[]): number {
  const wide = clamp01((a.aspect - 1) / 0.5); // aspect 1.5 -> 1
  return alternation(angles).regularity * wide;
}

// ---------- Theme scorers ----------

/**
 * Serpent: simple path, >= 5 stars. Shape: winds (length/endpoint >= 1.6) or turns
 * direction >= 2 times. Suppressed when the path is a wide, regular zigzag (that is a crown).
 */
function scoreSerpent(a: Analysis): number {
  const p = a.path;
  if (!p || p.length < 5) return 0;
  const angles = turnAngles(p);
  const wp = clamp01((windingRatio(p) - 1.2) / 0.4); // 1.6 -> 1
  const ap = clamp01(alternation(angles).changes / 2); // >= 2 flips -> 1
  return grade(true, (1 - crownness(a, angles)) * Math.max(wp, ap));
}

/** Crown: simple path, >= 5 stars, zigzag alternating at nearly every vertex along a wide, flat axis. */
function scoreCrown(a: Analysis): number {
  const p = a.path;
  if (!p || p.length < 5) return 0;
  return grade(true, crownness(a, turnAngles(p)));
}

/**
 * Hound: tree, >= 6 stars, >= 2 branch nodes (body with legs/head).
 * Shape: branch nodes form a compact body (span <= 0.6 of the figure's size).
 */
function scoreHound(a: Analysis): number {
  const b = a.branches;
  if (!a.isTree || b.length < 2 || a.V < 6) return 0;
  let span = 0;
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      span = Math.max(span, dist(a.pos.get(b[i])!, a.pos.get(b[j])!));
    }
  }
  return grade(true, (1 - span / a.scale) / 0.4);
}

/**
 * Archer: tree, >= 5 stars, exactly one branch node with >= 3 arms (the hub).
 * Shape: hub has 3+ arms (0.5) and some pair of arms runs straight through the hub, like a shaft (0.5).
 */
function scoreArcher(a: Analysis): number {
  if (!a.isTree || a.branches.length !== 1 || a.V < 5) return 0;
  const hub = a.branches[0];
  const hp = a.pos.get(hub)!;
  const nbrs = a.adj.get(hub)!;
  let straight = 0;
  for (let i = 0; i < nbrs.length; i++) {
    for (let j = i + 1; j < nbrs.length; j++) {
      const u = a.pos.get(nbrs[i])!;
      const v = a.pos.get(nbrs[j])!;
      const ax = u.x - hp.x, ay = u.y - hp.y, bx = v.x - hp.x, by = v.y - hp.y;
      const angle = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)); // 0..PI
      straight = Math.max(straight, clamp01(1 - Math.abs(angle - Math.PI) / (Math.PI / 2)));
    }
  }
  return grade(true, 0.5 * clamp01(nbrs.length - 2) + 0.5 * straight);
}

/**
 * Chalice: exactly one cycle (the cup, 3-5 stars) plus a stem path of >= 2 stars hanging from one cup star.
 * Shape: stem tip lies below the cup centroid (y grows downward), by 30% of the figure's size.
 */
function scoreChalice(a: Analysis): number {
  if (a.cycles !== 1) return 0;
  const core = twoCore(a); // cup = 2-core of a unicyclic graph
  const stem = a.ids.filter((id) => !core.has(id));
  const attachments = a.ids.filter(
    (id) => core.has(id) && a.adj.get(id)!.some((v) => !core.has(v)),
  ).length;
  const ok =
    core.size >= 3 &&
    core.size <= 5 &&
    stem.length >= 2 &&
    stem.every((id) => a.degree.get(id)! <= 2) &&
    attachments === 1;
  if (!ok) return 0;

  const tip = stem.find((id) => a.degree.get(id) === 1)!;
  let cupY = 0;
  for (const id of core) cupY += a.pos.get(id)!.y;
  cupY /= core.size;
  const dy = (a.pos.get(tip)!.y - cupY) / a.scale;
  return grade(true, dy / 0.3);
}

/** Repeatedly strip degree-<=1 nodes; what remains is the cycle(s). */
function twoCore(a: Analysis): Set<number> {
  const deg = new Map(a.degree);
  const removed = new Set<number>();
  const queue = a.ids.filter((id) => deg.get(id)! <= 1);
  while (queue.length) {
    const u = queue.pop()!;
    if (removed.has(u)) continue;
    removed.add(u);
    for (const v of a.adj.get(u)!) {
      if (removed.has(v)) continue;
      deg.set(v, deg.get(v)! - 1);
      if (deg.get(v)! <= 1) queue.push(v);
    }
  }
  return new Set(a.ids.filter((id) => !removed.has(id)));
}

const SCORERS: Record<Exclude<ThemeId, 'unnamed'>, (a: Analysis) => number> = {
  serpent: scoreSerpent,
  crown: scoreCrown,
  hound: scoreHound,
  archer: scoreArcher,
  chalice: scoreChalice,
};

// ---------- Recognition ----------

/**
 * Scores the drawn graph against each theme and returns the best one.
 * Invalid input -> unnamed, score 0. Best score < THRESHOLD -> unnamed with that best score.
 * Ties go to the earlier entry in THEMES, so the result never depends on edge order or star ids.
 */
export function recognizeConstellation(sky: Sky, c: Constellation): ConstellationMatch {
  const unnamed = (score: number): ConstellationMatch => ({
    theme: 'unnamed',
    name: THEME_INFO.unnamed.name,
    score,
  });
  if (!validateConstellation(sky, c).ok) return unnamed(0);

  const a = analyse(sky, c);
  let best: Exclude<ThemeId, 'unnamed'> = THEMES[0];
  let bestScore = -1;
  for (const theme of THEMES) {
    const s = SCORERS[theme](a);
    if (s > bestScore) {
      best = theme;
      bestScore = s;
    }
  }
  if (bestScore < THRESHOLD) return unnamed(bestScore);
  return { theme: best, name: THEME_INFO[best].name, score: bestScore };
}
