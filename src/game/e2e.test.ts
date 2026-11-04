import { describe, expect, it } from 'vitest';
import { recognizeConstellation, validateConstellation } from '../core/constellations';
import { generateDungeon, isWalkable, tileAt } from '../core/dungeon';
import { distance } from '../core/rules';
import { createRng } from '../core/rng';
import { generateSky } from '../core/sky';
import { MAX_STARS, MIN_STARS } from '../core/types';
import type {
  ClassId,
  Constellation,
  DungeonMap,
  Hero,
  Point,
  Rng,
  Sky,
  ThemeId,
} from '../core/types';
import { endDelve, newCampaign } from './campaign';
import { DungeonEngine } from './dungeonEngine';
import type { EngineEvent } from './dungeonEngine';

// Headless end-to-end fuzz: sky -> constellation -> recognise -> dungeon -> engine with a random bot.

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const CLASSES: ClassId[] = ['fighter', 'thief', 'priest', 'wizard'];
const MAX_ACTIONS = 3000;
const EXIT_CHANCE = 0.05;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

interface Failure { seed: number; step: number; problem: string }

/** The `count` stars nearest to star `from`, nearest first (excluding `from`). */
function nearestIds(sky: Sky, from: number, count: number): number[] {
  const src = sky.stars.find((s) => s.id === from)!;
  return sky.stars
    .filter((s) => s.id !== from)
    .map((s) => ({ id: s.id, d: Math.hypot(s.x - src.x, s.y - src.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((s) => s.id);
}

/** Draws the way a player would: connect to one of the 3 nearest stars, sometimes from an older star, sometimes closing a loop. */
function drawConstellation(sky: Sky, rng: Rng): Constellation {
  const target = rng.int(MIN_STARS, MAX_STARS);
  const starIds = [rng.pick(sky.stars).id];
  const edges: Array<[number, number]> = [];
  const linked = (a: number, b: number): boolean =>
    edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  let last = starIds[0];
  for (let guard = 0; guard < 500 && starIds.length < target; guard++) {
    const from = rng.next() < 0.3 ? rng.pick(starIds) : last;
    const near = nearestIds(sky, from, 3);
    if (rng.next() < 0.2) {
      const loops = near.filter((id) => starIds.includes(id) && !linked(from, id));
      if (loops.length > 0) {
        edges.push([from, rng.pick(loops)]);
        continue;
      }
    }
    const fresh = near.filter((id) => !starIds.includes(id));
    if (fresh.length === 0) continue;
    const next = rng.pick(fresh);
    edges.push([from, next]);
    starIds.push(next);
    last = next;
  }
  return { starIds, edges };
}

/** Sky, constellation and RNG for a seed. Shared by the fuzz and the theme-distribution test. */
function drawCase(seed: number): { sky: Sky; rng: Rng; c: Constellation } {
  const sky = generateSky(seed);
  const rng = createRng(seed + 1_000_003);
  for (let attempt = 0; attempt < 20; attempt++) {
    const c = drawConstellation(sky, rng);
    if (validateConstellation(sky, c).ok) return { sky, rng, c };
  }
  throw new Error(`seed ${seed}: could not draw a valid constellation`);
}

const LOG_BAD = /undefined|NaN/;
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Engine events that carry text or numbers must not show bad values. */
function eventProblems(events: EngineEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind === 'log' && LOG_BAD.test(e.text)) out.push(`log "${e.text}"`);
    if (e.kind === 'attack' && !Number.isFinite(e.damage)) out.push(`attack damage ${e.damage}`);
  }
  return out;
}

/** Invariants that must hold after every action. */
function stateProblems(engine: DungeonEngine, hero: Hero, map: DungeonMap): string[] {
  const out: string[] = [];
  if (!(hero.hp >= 0 && hero.hp <= hero.maxHp)) out.push(`hero hp ${hero.hp} outside 0..${hero.maxHp}`);
  if (engine.remainingMovement < 0) out.push(`negative movement ${engine.remainingMovement}`);
  if (engine.mode === 'combat' && engine.outcome === null && engine.currentActor?.id !== 'hero') {
    out.push(`combat waiting on ${engine.currentActor?.id ?? 'nobody'}, not the hero`);
  }

  const occupied = new Map<string, string>();
  const living: Array<{ name: string; pos: Point }> = [];
  if (hero.hp > 0) living.push({ name: 'hero', pos: hero.pos });
  for (const m of engine.livingMonsters) living.push({ name: `${m.name}#${m.id}`, pos: m.pos });
  for (const c of living) {
    const k = `${c.pos.x},${c.pos.y}`;
    const prior = occupied.get(k);
    if (prior) out.push(`${c.name} and ${prior} share tile ${k}`);
    occupied.set(k, c.name);
    if (!isWalkable(tileAt(map, c.pos.x, c.pos.y))) out.push(`${c.name} on non-walkable tile ${k}`);
  }
  return out;
}

/** One bot action. Returns the events it produced. */
function botAct(engine: DungeonEngine, map: DungeonMap, hero: Hero, rng: Rng): EngineEvent[] {
  const living = engine.livingMonsters;
  const inCombat = engine.mode === 'combat';
  const canAct = engine.actionAvailable;
  const adjacent = living.filter((m) => distance(m.pos, hero.pos) === 1);
  const seen = living.filter((m) => engine.isVisible(m.pos));
  const ranged = engine.rangedTargets();
  const r = rng.next();

  if (r < 0.10 && adjacent.length > 0 && canAct) return engine.attackAt(rng.pick(adjacent).pos);
  if (r < 0.18 && ranged.length > 0 && canAct) return engine.rangedAttack(rng.pick(ranged).id);
  if (r < 0.26 && canAct) return castRandom(engine, hero, seen, rng);
  if (r < 0.30 && inCombat && canAct) return engine.dash();
  if (r < 0.90 && (!inCombat || engine.remainingMovement > 0)) {
    let dx: number;
    let dy: number;
    if (seen.length > 0 && rng.next() < 0.5) {
      const t = seen.reduce((best, m) => (distance(m.pos, hero.pos) < distance(best.pos, hero.pos) ? m : best));
      dx = Math.sign(t.pos.x - hero.pos.x);
      dy = Math.sign(t.pos.y - hero.pos.y);
    } else {
      [dx, dy] = rng.pick(DIRS);
    }
    // Most players do not walk straight out of the dungeon; the exit is only taken rarely.
    const lands = { x: hero.pos.x + dx, y: hero.pos.y + dy };
    if (samePoint(lands, map.exit) && rng.next() > EXIT_CHANCE) {
      return engine.endTurn();
    }
    return engine.tryMove(dx, dy);
  }
  return engine.endTurn();
}

function castRandom(engine: DungeonEngine, hero: Hero, seen: Array<{ pos: Point }>, rng: Rng): EngineEvent[] {
  const known = hero.spells.filter((s) => !hero.lostSpells.includes(s));
  if (known.length === 0) return engine.endTurn();
  const spell = rng.pick(known);
  if (!engine.needsTarget(spell)) return engine.cast(spell);
  // Mostly a visible monster; sometimes a random tile, which exercises the refusal paths.
  const target = seen.length > 0 && rng.next() < 0.7
    ? rng.pick(seen).pos
    : { x: hero.pos.x + rng.int(-7, 7), y: hero.pos.y + rng.int(-7, 7) };
  return engine.cast(spell, target);
}

/** Runs one seed end to end. Returns the first problem found, or null. */
function runSeed(seed: number): { step: number; problem: string } | null {
  const { sky, rng, c } = drawCase(seed);
  const match = recognizeConstellation(sky, c);
  const theme: ThemeId = match.theme;
  const map = generateDungeon(sky, c, theme, rng.int(1, 0x7fffffff));

  const camp = newCampaign(`Hero${seed}`, CLASSES[seed % CLASSES.length], seed);
  const hero = camp.hero;
  const engine = new DungeonEngine(map, hero, rng.int(1, 0x7fffffff));
  const bot = createRng(seed * 31 + 7);

  let step = 0;
  for (; step < MAX_ACTIONS && engine.outcome === null; step++) {
    const events = botAct(engine, map, hero, bot);
    const problems = [...eventProblems(events), ...stateProblems(engine, hero, map)];
    if (problems.length > 0) return { step, problem: problems.join('; ') };
  }

  const logProblem = engine.log.find((l) => LOG_BAD.test(l));
  if (logProblem !== undefined) return { step, problem: `bad log line "${logProblem}"` };

  endDelve(camp, engine.outcome ?? 'escaped', theme, createRng(seed + 99));
  const h = camp.hero;
  const campProblems: string[] = [];
  if (h.gold < 0) campProblems.push(`gold ${h.gold} < 0`);
  if (h.maxHp < 1) campProblems.push(`maxHp ${h.maxHp} < 1`);
  if (h.level < 1 || h.level > 10) campProblems.push(`level ${h.level} outside 1..10`);
  if (campProblems.length > 0) return { step, problem: `campaign: ${campProblems.join('; ')}` };
  return null;
}

describe('end-to-end fuzz', () => {
  it('plays 200 random constellations through the whole pipeline without violations', () => {
    const failures: Failure[] = [];
    for (const seed of SEEDS) {
      try {
        const f = runSeed(seed);
        if (f) failures.push({ seed, ...f });
      } catch (e) {
        failures.push({ seed, step: -1, problem: `threw: ${(e as Error).stack ?? String(e)}` });
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('recogniser theme distribution', () => {
  it('logs how the random pool spreads across themes', () => {
    const counts: Record<ThemeId, number> = { serpent: 0, crown: 0, hound: 0, archer: 0, chalice: 0, unnamed: 0 };
    for (const seed of SEEDS) {
      const { sky, c } = drawCase(seed);
      counts[recognizeConstellation(sky, c).theme] += 1;
    }
    console.log(`theme distribution over ${SEEDS.length} random constellations:`, counts);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(SEEDS.length);
    for (const theme of ['serpent', 'crown', 'hound', 'archer', 'chalice'] as const) {
      expect(counts[theme], `no ${theme} constellation in the pool`).toBeGreaterThan(0);
    }
  });
});
