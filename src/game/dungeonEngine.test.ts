import { describe, expect, it } from 'vitest';
import { createHero } from '../core/rules';
import { createRng } from '../core/rng';
import { Tile, TORCH_TURNS } from '../core/types';
import type { DungeonMap, Hero, MonsterSpawn, Point, ThemeId, TreasureSpawn } from '../core/types';
import { DungeonEngine } from './dungeonEngine';

/** '#' wall, '.' floor, '+' door, ' ' void, '@' start, '>' exit. */
function buildMap(
  rows: string[],
  opts: { monsters?: MonsterSpawn[]; treasure?: TreasureSpawn[]; theme?: ThemeId } = {},
): DungeonMap {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const tiles: Tile[] = [];
  let start: Point | undefined;
  let exit: Point | undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? ' ';
      let t = Tile.Void;
      if (ch === '#') t = Tile.Wall;
      else if (ch === '+') t = Tile.Door;
      else if (ch !== ' ') t = Tile.Floor;
      if (ch === '@') start = { x, y };
      if (ch === '>') {
        exit = { x, y };
        t = Tile.Exit;
      }
      tiles.push(t);
    }
  }
  if (!start) throw new Error('test map needs @');
  return {
    width,
    height,
    tiles,
    rooms: [],
    corridors: [],
    start,
    exit: exit ?? { x: -1, y: -1 },
    monsters: opts.monsters ?? [],
    treasure: opts.treasure ?? [],
    theme: opts.theme ?? 'unnamed',
  };
}

const newHero = (seed = 1): Hero => createHero('Tester', 'fighter', createRng(seed));
const idx = (map: DungeonMap, p: Point): number => p.y * map.width + p.x;

describe('DungeonEngine', () => {
  it('FOV is blocked by walls', () => {
    const map = buildMap([
      '###########',
      '#.........#',
      '#..@.#....#',
      '#.........#',
      '###########',
    ]);
    const engine = new DungeonEngine(map, newHero(), 1);
    expect(engine.visible.has(idx(map, { x: 1, y: 1 }))).toBe(true);
    expect(engine.visible.has(idx(map, { x: 5, y: 2 }))).toBe(true); // the wall itself is seen
    expect(engine.visible.has(idx(map, { x: 7, y: 2 }))).toBe(false); // behind the wall
    expect(engine.explored.has(idx(map, { x: 7, y: 2 }))).toBe(false);
  });

  it('picks up treasure when moved onto', () => {
    const map = buildMap([
      '#######',
      '#@....#',
      '#.....#',
      '#....>#',
      '#######',
    ], { treasure: [{ roomId: 0, pos: { x: 3, y: 1 }, gold: 7 }] });
    const hero = newHero();
    const engine = new DungeonEngine(map, hero, 1);
    engine.tryMove(1, 0);
    engine.tryMove(1, 0);
    expect(hero.carriedGold).toBe(7);
    expect(engine.remainingTreasure).toHaveLength(0);
    expect(engine.log.some((l) => l.includes('7 gold'))).toBe(true);
  });

  it('stepping onto the exit escapes', () => {
    const map = buildMap([
      '#######',
      '#@....#',
      '#.....#',
      '#....>#',
      '#######',
    ]);
    const engine = new DungeonEngine(map, newHero(), 1);
    engine.tryMove(1, 1);
    engine.tryMove(1, 1);
    engine.tryMove(1, 0);
    expect(engine.outcome).toBeNull();
    engine.tryMove(1, 0);
    expect(engine.outcome).toBe('escaped');
  });

  it('combat starts when a monster is seen, not while it is hidden', () => {
    const map = buildMap([
      '###########',
      '#.........#',
      '#..@.#....#',
      '#.........#',
      '###########',
    ], { monsters: [{ roomId: 0, pos: { x: 7, y: 2 }, monsterId: 'rat' }] });
    const engine = new DungeonEngine(map, newHero(), 1);
    expect(engine.visible.has(idx(map, { x: 7, y: 2 }))).toBe(false);
    expect(engine.mode).toBe('explore');

    engine.tryMove(1, -1); // (4,1): line of sight to (7,2) opens
    expect(engine.mode).toBe('combat');
    expect(engine.log.some((l) => l.startsWith('Combat! Initiative'))).toBe(true);
  });

  it('sleeping monsters do not become aware', () => {
    const map = buildMap([
      '###########',
      '#.........#',
      '#..@.#....#',
      '#.........#',
      '###########',
    ], { monsters: [{ roomId: 0, pos: { x: 7, y: 2 }, monsterId: 'rat' }] });
    const engine = new DungeonEngine(map, newHero(), 1);
    engine.monsters[0].sleeping = true;
    engine.tryMove(1, -1);
    engine.tryMove(1, 0);
    expect(engine.isVisible({ x: 7, y: 2 })).toBe(true);
    expect(engine.mode).toBe('explore');
  });

  it('melee kills a sleeping monster and grants XP', () => {
    const map = buildMap([
      '#####',
      '#@..#',
      '#...#',
      '#####',
    ], { monsters: [{ roomId: 0, pos: { x: 2, y: 1 }, monsterId: 'rat' }] });
    const hero = newHero();
    const engine = new DungeonEngine(map, hero, 1);
    const rat = engine.monsters[0];
    rat.sleeping = true;
    rat.ac = 0; // any non-natural-1 hits
    rat.hp = 1;
    const xpBefore = hero.xp;

    // Sleeping target gives advantage; retry in case of a double natural 1.
    for (let i = 0; i < 20 && rat.hp > 0; i++) engine.tryMove(1, 0);

    expect(rat.hp).toBe(0);
    expect(hero.xp - xpBefore).toBe(rat.xpValue);
    expect(engine.mode).toBe('explore');
    expect(engine.log.some((l) => l.includes('slain'))).toBe(true);
  });

  it('hero death sets outcome to died', () => {
    const map = buildMap([
      '#######',
      '#@....#',
      '#.....#',
      '#######',
    ], { monsters: [{ roomId: 0, pos: { x: 2, y: 1 }, monsterId: 'goblin' }] });
    const hero = newHero();
    const engine = new DungeonEngine(map, hero, 3);
    hero.hp = 1;
    hero.ac = 0;
    for (let i = 0; i < 50 && engine.outcome === null; i++) engine.endTurn();
    expect(engine.outcome).toBe('died');
    expect(hero.hp).toBe(0);
  });

  it('torch burns down, auto-lights the next, and darkness limits FOV to radius 1', () => {
    const rows = [
      '###########',
      '#.........#',
      '#....@....#',
      '#.........#',
      '###########',
    ];
    const walk = (engine: DungeonEngine, steps: number): void => {
      for (let i = 0; i < steps; i++) engine.tryMove(i % 2 === 0 ? -1 : 1, 0);
    };

    // No torches at all: starts in darkness.
    const darkHero = newHero();
    darkHero.torches = 0;
    const dark = new DungeonEngine(buildMap(rows), darkHero, 1);
    expect(dark.isDark).toBe(true);
    for (const i of dark.visible) {
      const x = i % dark.map.width;
      const y = Math.floor(i / dark.map.width);
      expect(Math.max(Math.abs(x - darkHero.pos.x), Math.abs(y - darkHero.pos.y))).toBeLessThanOrEqual(1);
    }
    expect(dark.visible.size).toBeLessThanOrEqual(9);

    // One torch: lasts TORCH_TURNS rounds of 6 exploration steps, then darkness.
    const oneHero = newHero();
    oneHero.torches = 1;
    const one = new DungeonEngine(buildMap(rows), oneHero, 1);
    expect(one.isDark).toBe(false);
    expect(one.torchRoundsLeft).toBe(TORCH_TURNS);
    walk(one, TORCH_TURNS * 6);
    expect(one.isDark).toBe(true);
    expect(oneHero.torches).toBe(0);
    expect(one.visible.size).toBeLessThanOrEqual(9);

    // Two torches: one is used at start, the second is lit automatically when it burns out.
    const twoHero = newHero();
    twoHero.torches = 2;
    const two = new DungeonEngine(buildMap(rows), twoHero, 1);
    expect(twoHero.torches).toBe(1);
    walk(two, TORCH_TURNS * 6);
    expect(two.isDark).toBe(false);
    expect(twoHero.torches).toBe(0);
    expect(two.torchRoundsLeft).toBe(TORCH_TURNS);
    expect(two.log.some((l) => l.includes('fresh one'))).toBe(true);
  });

  it('monsters path around walls to reach the hero', () => {
    // Monster at (3,3) can see the hero diagonally through (2,2), but the diagonal step
    // past the wall corner is illegal, so it has to walk around via the top corridor.
    const map = buildMap([
      '######',
      '#@...#',
      '#..#.#',
      '#.#..#',
      '######',
    ], { monsters: [{ roomId: 0, pos: { x: 3, y: 3 }, monsterId: 'goblin' }] });
    const hero = newHero();
    hero.hp = 500;
    hero.maxHp = 500;
    const engine = new DungeonEngine(map, hero, 5);
    const goblin = engine.monsters[0];
    for (let i = 0; i < 5 && !(goblin.pos.x === 2 && goblin.pos.y === 1); i++) engine.endTurn();
    expect(goblin.pos).toEqual({ x: 2, y: 1 });
    expect(engine.outcome).toBeNull();
  });

  it('is deterministic for the same seed', () => {
    const rows = [
      '###########',
      '#@........#',
      '#.........#',
      '#.........#',
      '###########',
    ];
    const spawns: MonsterSpawn[] = [
      { roomId: 0, pos: { x: 7, y: 2 }, monsterId: 'goblin' },
      { roomId: 0, pos: { x: 9, y: 3 }, monsterId: 'rat' },
    ];
    const play = (): { log: string[]; hp: number } => {
      const hero = newHero(7);
      const engine = new DungeonEngine(buildMap(rows, { monsters: spawns }), hero, 99);
      for (let i = 0; i < 12; i++) {
        engine.tryMove(1, 0);
        engine.endTurn();
      }
      return { log: [...engine.log], hp: hero.hp };
    };
    expect(play()).toEqual(play());
  });
});
