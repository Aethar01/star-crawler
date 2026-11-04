import { describe, it, expect } from 'vitest';
import { generateDungeon, isWalkable, pickFloorTile, tileAt } from './dungeon';
import { createRng } from './rng';
import { Tile } from './types';
import type { Constellation, DungeonMap, Point, Room, Sky, Star } from './types';

const sky: Sky = {
  seed: 1,
  stars: [
    { id: 0, x: 0.1, y: 0.5, brightness: 2 },
    { id: 1, x: 0.3, y: 0.2, brightness: 3 },
    { id: 2, x: 0.35, y: 0.8, brightness: 4 },
    { id: 3, x: 0.6, y: 0.4, brightness: 5 },
    { id: 4, x: 0.8, y: 0.15, brightness: 2 },
    { id: 5, x: 0.85, y: 0.7, brightness: 3 },
  ],
};

// Path 0-1-2-3-4 with a branch 2-5.
const constellation: Constellation = {
  starIds: [0, 1, 2, 3, 4, 5],
  edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]],
};

const centre = (r: Room): Point => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
const inRoom = (r: Room, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const k = (p: Point): string => `${p.x},${p.y}`;

function reachable(map: DungeonMap): Set<number> {
  const seen = new Set<number>([map.start.y * map.width + map.start.x]);
  const queue: Point[] = [map.start];
  for (let qi = 0; qi < queue.length; qi++) {
    const { x, y } = queue[qi];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(tileAt(map, nx, ny))) continue;
      const i = ny * map.width + nx;
      if (seen.has(i)) continue;
      seen.add(i);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

function reachabilityViolations(map: DungeonMap): string[] {
  const seen = reachable(map);
  const out: string[] = [];
  for (const r of map.rooms) {
    const c = centre(r);
    if (!seen.has(c.y * map.width + c.x)) out.push(`room ${r.id} unreachable`);
  }
  return out;
}

function overlapViolations(map: DungeonMap): string[] {
  const out: string[] = [];
  for (let i = 0; i < map.rooms.length; i++) {
    for (let j = i + 1; j < map.rooms.length; j++) {
      const a = map.rooms[i];
      const b = map.rooms[j];
      // Each room grown by 2 tiles of padding must not touch the other.
      const hit = a.x - 2 < b.x + b.w + 2 && b.x - 2 < a.x + a.w + 2
        && a.y - 2 < b.y + b.h + 2 && b.y - 2 < a.y + a.h + 2;
      if (hit) out.push(`rooms ${a.id} and ${b.id} overlap`);
    }
  }
  return out;
}

function entityViolations(map: DungeonMap): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  const claim = (p: Point, what: string): void => {
    if (!isWalkable(tileAt(map, p.x, p.y))) out.push(`${what} at ${k(p)} not walkable`);
    const prev = seen.get(k(p));
    if (prev) out.push(`${what} shares tile ${k(p)} with ${prev}`);
    seen.set(k(p), what);
  };
  claim(map.start, 'start');
  claim(map.exit, 'exit');
  for (const m of map.monsters) {
    claim(m.pos, `monster ${m.monsterId}`);
    const r = map.rooms[m.roomId];
    if (!inRoom(r, m.pos)) out.push(`monster ${m.monsterId} outside room ${r.id}`);
    if (r.kind === 'entrance') out.push('monster in entrance room');
  }
  for (const t of map.treasure) {
    claim(t.pos, 'treasure');
    const r = map.rooms[t.roomId];
    if (!inRoom(r, t.pos)) out.push(`treasure outside room ${r.id}`);
  }
  return out;
}

function wallViolations(map: DungeonMap): string[] {
  const out: string[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isWalkable(tileAt(map, x, y))) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (tileAt(map, x + dx, y + dy) === Tile.Void) out.push(`walkable ${x},${y} borders void`);
        }
      }
    }
  }
  return out;
}

function allViolations(map: DungeonMap): string[] {
  return [
    ...reachabilityViolations(map),
    ...overlapViolations(map),
    ...entityViolations(map),
    ...wallViolations(map),
  ];
}

describe('generateDungeon', () => {
  const map = generateDungeon(sky, constellation, 'serpent', 42);

  it('is deterministic for the same inputs', () => {
    const again = generateDungeon(sky, constellation, 'serpent', 42);
    expect(JSON.stringify(again)).toEqual(JSON.stringify(map));
  });

  it('has the requested size, theme, and all-tiles-set layout', () => {
    expect(map.width).toBe(80);
    expect(map.height).toBe(54);
    expect(map.tiles).toHaveLength(80 * 54);
    expect(map.theme).toBe('serpent');
  });

  it('makes one room per star', () => {
    expect(map.rooms).toHaveLength(constellation.starIds.length);
    expect(map.rooms.map((r) => r.starId).sort()).toEqual([...constellation.starIds].sort());
  });

  it('has exactly one entrance and one boss', () => {
    const entrances = map.rooms.filter((r) => r.kind === 'entrance');
    const bosses = map.rooms.filter((r) => r.kind === 'boss');
    expect(entrances).toHaveLength(1);
    expect(entrances[0].starId).toBe(0);
    expect(bosses).toHaveLength(1);
    // Star 3 is the brightest (5) of the remaining stars.
    expect(bosses[0].starId).toBe(3);
    expect(bosses[0].danger).toBe(5);
    expect(entrances[0].danger).toBe(1);
  });

  it('keeps rooms from overlapping', () => {
    expect(overlapViolations(map)).toEqual([]);
  });

  it('makes every room reachable from start over walkable tiles', () => {
    expect(reachabilityViolations(map)).toEqual([]);
  });

  it('places monsters and treasure on walkable tiles inside their room, with no shared tiles', () => {
    expect(entityViolations(map)).toEqual([]);
  });

  it('puts the boss at its room centre', () => {
    const boss = map.rooms.find((r) => r.kind === 'boss')!;
    expect(map.monsters.some((m) => m.roomId === boss.id && m.monsterId === 'serpent-queen'
      && m.pos.x === centre(boss).x && m.pos.y === centre(boss).y)).toBe(true);
  });

  it('gives no monsters to the entrance and treasure to every other room', () => {
    const entrance = map.rooms[0];
    expect(map.monsters.some((m) => m.roomId === entrance.id)).toBe(false);
    const treasureRooms = map.treasure.map((t) => t.roomId).sort();
    expect(treasureRooms).toEqual(map.rooms.slice(1).map((r) => r.id));
  });

  it('places the exit as an Exit tile next to start, inside the entrance room', () => {
    expect(tileAt(map, map.exit.x, map.exit.y)).toBe(Tile.Exit);
    expect(map.exit).not.toEqual(map.start);
    expect(Math.abs(map.exit.x - map.start.x) + Math.abs(map.exit.y - map.start.y)).toBe(1);
    expect(inRoom(map.rooms[0], map.exit)).toBe(true);
  });

  it('walls off every walkable tile', () => {
    expect(wallViolations(map)).toEqual([]);
  });

  it('builds one corridor per edge, connecting the right rooms', () => {
    expect(map.corridors).toHaveLength(constellation.edges.length);
    for (const cor of map.corridors) {
      expect(cor.path.length).toBeGreaterThan(0);
      for (const p of cor.path) expect(isWalkable(tileAt(map, p.x, p.y))).toBe(true);
    }
  });
});

describe('generateDungeon fuzz', () => {
  function randomCase(seed: number): { sky: Sky; c: Constellation } {
    const rng = createRng(seed);
    const stars: Star[] = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: rng.next(),
      y: rng.next(),
      brightness: rng.int(1, 5),
    }));

    // Random ordering of star ids; first one is the entrance.
    const order = stars.map((s) => s.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }

    // Spanning tree plus one extra edge.
    const edges: Array<[number, number]> = [];
    const seen = new Set<string>();
    const add = (a: number, b: number): boolean => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a === b || seen.has(key)) return false;
      seen.add(key);
      edges.push([a, b]);
      return true;
    };
    for (let i = 1; i < order.length; i++) add(order[i], order[rng.int(0, i - 1)]);
    for (let tries = 0; tries < 100; tries++) {
      if (add(order[rng.int(0, order.length - 1)], order[rng.int(0, order.length - 1)])) break;
    }

    return { sky: { seed, stars }, c: { starIds: order, edges } };
  }

  it('satisfies reachability, no-overlap, entity and wall rules for 50 random seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { sky: s, c } = randomCase(seed);
      const map = generateDungeon(s, c, 'hound', seed);
      expect({ seed, problems: allViolations(map) }).toEqual({ seed, problems: [] });
    }
  });
});

describe('pickFloorTile', () => {
  it('returns undefined instead of throwing when a tiny room overflows', () => {
    // 3x3 floor room, 9 tiles. Ask for 12 spawns: 9 succeed on distinct tiles, 3 are skipped.
    // Full-size grid (80 wide, as generateDungeon uses); only the 3x3 room at (2,2) is floor.
    const tiles: Tile[] = new Array<Tile>(80 * 54).fill(Tile.Wall);
    const room = { x: 2, y: 2, w: 3, h: 3 };
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) tiles[y * 80 + x] = Tile.Floor;
    }
    const occupied = new Set<string>();
    const rng = createRng(7);
    const results: Array<Point | undefined> = [];
    expect(() => {
      for (let i = 0; i < 12; i++) results.push(pickFloorTile(tiles, room, occupied, rng));
    }).not.toThrow();

    const placed = results.filter((p): p is Point => p !== undefined);
    expect(placed).toHaveLength(9);
    expect(results.slice(9)).toEqual([undefined, undefined, undefined]);
    expect(new Set(placed.map(k)).size).toBe(9);
    expect(occupied.size).toBe(9);
  });
});
