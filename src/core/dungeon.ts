import { createRng } from './rng';
import { Tile, THEME_MONSTERS } from './types';
import type {
  Constellation,
  Corridor,
  DungeonMap,
  MonsterSpawn,
  Point,
  Rng,
  Room,
  Sky,
  Star,
  ThemeId,
  TreasureSpawn,
} from './types';

const WIDTH = 80;
const HEIGHT = 54;
const MARGIN = 6;
const PAD = 2;
const MIN_ROOM = 3;
const MAX_PASSES = 50;

/** Floor rectangle in tile space (x, y inclusive top-left; w, h > 0). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tileAt(map: DungeonMap, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Void;
  return map.tiles[y * map.width + x];
}

export function isWalkable(t: Tile): boolean {
  return t === Tile.Floor || t === Tile.Door || t === Tile.Exit;
}

function inRect(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function centreOf(r: Rect): Point {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

const key = (p: Point): string => `${p.x},${p.y}`;

/** Keeps a floor rect inside [2, WIDTH-3] x [2, HEIGHT-3]. */
function clampRect(r: Rect): void {
  r.w = Math.min(r.w, WIDTH - 4);
  r.h = Math.min(r.h, HEIGHT - 4);
  r.x = Math.min(Math.max(r.x, 2), WIDTH - 2 - r.w);
  r.y = Math.min(Math.max(r.y, 2), HEIGHT - 2 - r.h);
}

/** True when both rects, each grown by PAD on every side, intersect. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x - PAD < b.x + b.w + PAD && b.x - PAD < a.x + a.w + PAD
    && a.y - PAD < b.y + b.h + PAD && b.y - PAD < a.y + a.h + PAD;
}

function anyOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) return true;
    }
  }
  return false;
}

/** Shrinks a rect by 1 tile on each side per axis, down to MIN_ROOM, keeping its centre. */
function shrink(r: Rect): void {
  const w = Math.max(MIN_ROOM, r.w - 2);
  const h = Math.max(MIN_ROOM, r.h - 2);
  r.x += Math.floor((r.w - w) / 2);
  r.y += Math.floor((r.h - h) / 2);
  r.w = w;
  r.h = h;
}

/**
 * Moves v away from o. Tries the axis of least (padded) overlap first; if that move would push
 * v out of the map, falls back to the other axis.
 */
function nudge(v: Rect, o: Rect): void {
  const ox = Math.min(v.x + v.w + PAD, o.x + o.w + PAD) - Math.max(v.x - PAD, o.x - PAD);
  const oy = Math.min(v.y + v.h + PAD, o.y + o.h + PAD) - Math.max(v.y - PAD, o.y - PAD);
  const xStep = { axis: 'x' as const, amt: ox, dir: v.x + v.w / 2 >= o.x + o.w / 2 ? 1 : -1 };
  const yStep = { axis: 'y' as const, amt: oy, dir: v.y + v.h / 2 >= o.y + o.h / 2 ? 1 : -1 };
  const steps = ox <= oy ? [xStep, yStep] : [yStep, xStep];
  for (const s of steps) {
    const trial = { ...v };
    trial[s.axis] += s.dir * s.amt;
    if (trial.x >= 2 && trial.y >= 2 && trial.x + trial.w <= WIDTH - 2 && trial.y + trial.h <= HEIGHT - 2) {
      v.x = trial.x;
      v.y = trial.y;
      return;
    }
  }
  v[steps[0].axis] += steps[0].dir * steps[0].amt;
  clampRect(v);
}

/**
 * Fallback for when the shrink/nudge passes do not converge (dense skies): places rooms one by
 * one, in index order, at the free spot nearest their desired centre, shrinking only if no spot fits.
 */
function packGreedy(rects: Rect[], desired: Rect[]): void {
  const placed: Rect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const want = desired[i];
    const cx = want.x + want.w / 2;
    const cy = want.y + want.h / 2;
    let spot: Rect | undefined;
    for (let s = 0; !spot; s++) {
      const w = Math.max(MIN_ROOM, want.w - 2 * s);
      const h = Math.max(MIN_ROOM, want.h - 2 * s);
      let bestD = Infinity;
      for (let x = 2; x <= WIDTH - 2 - w; x++) {
        for (let y = 2; y <= HEIGHT - 2 - h; y++) {
          const cand = { x, y, w, h };
          if (placed.some((p) => overlaps(cand, p))) continue;
          const d = (x + w / 2 - cx) ** 2 + (y + h / 2 - cy) ** 2;
          if (d < bestD) {
            bestD = d;
            spot = cand;
          }
        }
      }
      if (!spot && w === MIN_ROOM && h === MIN_ROOM) throw new Error('generateDungeon: no room space');
    }
    rects[i] = spot;
    placed.push(spot);
  }
}

/** Shrinks the dimmer room (later one on a tie), then nudges it apart if still overlapping. */
function resolveOverlaps(rects: Rect[], brightness: number[]): void {
  const desired = rects.map((r) => ({ ...r }));
  for (let pass = 0; pass < MAX_PASSES && anyOverlap(rects); pass++) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (!overlaps(rects[i], rects[j])) continue;
        const v = brightness[i] < brightness[j] ? i : j;
        const o = v === i ? j : i;
        shrink(rects[v]);
        if (overlaps(rects[v], rects[o])) nudge(rects[v], rects[o]);
      }
    }
  }
  if (anyOverlap(rects)) packGreedy(rects, desired);
}

/** BFS edge-distance from the entrance star over the constellation graph. */
function edgeDistances(c: Constellation): Map<number, number> {
  const adj = new Map<number, number[]>();
  for (const id of c.starIds) adj.set(id, []);
  for (const [a, b] of c.edges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  const entrance = c.starIds[0];
  const dist = new Map<number, number>([[entrance, 0]]);
  const queue = [entrance];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const next of adj.get(cur) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, (dist.get(cur) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/** L-shaped path from a to b, horizontal segment first or vertical first. Includes both ends. */
function lPath(a: Point, b: Point, horizontalFirst: boolean): Point[] {
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  const pts: Point[] = [{ x: a.x, y: a.y }];
  const cur = { x: a.x, y: a.y };
  for (const target of [corner, b]) {
    while (cur.x !== target.x) {
      cur.x += Math.sign(target.x - cur.x);
      pts.push({ x: cur.x, y: cur.y });
    }
    while (cur.y !== target.y) {
      cur.y += Math.sign(target.y - cur.y);
      pts.push({ x: cur.x, y: cur.y });
    }
  }
  return pts;
}

/**
 * Picks a random floor tile inside the room that is not occupied, and marks it occupied.
 * Returns undefined when the room has no free floor left; callers skip that spawn.
 */
export function pickFloorTile(tiles: Tile[], room: Rect, occupied: Set<string>, rng: Rng): Point | undefined {
  const free: Point[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (tiles[y * WIDTH + x] === Tile.Floor && !occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return undefined;
  const p = rng.pick(free);
  occupied.add(key(p));
  return p;
}

export function generateDungeon(sky: Sky, c: Constellation, theme: ThemeId, seed: number): DungeonMap {
  const rng = createRng(seed);

  const starById = new Map<number, Star>(sky.stars.map((s): [number, Star] => [s.id, s]));
  const stars = c.starIds.map((id) => {
    const s = starById.get(id);
    if (!s) throw new Error(`generateDungeon: star ${id} not in sky`);
    return s;
  });
  const n = stars.length;

  // 1. Room rectangles from star positions and brightness.
  const rects: Rect[] = stars.map((s) => {
    const cx = Math.round(MARGIN + s.x * (WIDTH - 2 * MARGIN));
    const cy = Math.round(MARGIN + s.y * (HEIGHT - 2 * MARGIN));
    const w = 3 + s.brightness + rng.int(0, 2);
    const h = 3 + s.brightness + rng.int(0, 2);
    const r = { x: cx - Math.floor(w / 2), y: cy - Math.floor(h / 2), w, h };
    clampRect(r);
    return r;
  });

  // 2. Separate overlapping rooms.
  resolveOverlaps(rects, stars.map((s) => s.brightness));

  // 3. Room kinds: entrance = first star; boss = brightest remaining star.
  const dist = edgeDistances(c);
  let bossIdx = -1;
  for (let i = 1; i < n; i++) {
    if (bossIdx === -1) {
      bossIdx = i;
      continue;
    }
    const cand = stars[i];
    const cur = stars[bossIdx];
    const candDist = dist.get(cand.id) ?? -1;
    const curDist = dist.get(cur.id) ?? -1;
    if (cand.brightness > cur.brightness
      || (cand.brightness === cur.brightness && (candDist > curDist
        || (candDist === curDist && cand.id < cur.id)))) {
      bossIdx = i;
    }
  }

  const rooms: Room[] = stars.map((s, i) => {
    const kind = i === 0 ? 'entrance' : i === bossIdx ? 'boss' : 'normal';
    const danger = kind === 'entrance' ? 1 : kind === 'boss' ? 5 : s.brightness;
    const r = rects[i];
    return { id: i, starId: s.id, x: r.x, y: r.y, w: r.w, h: r.h, kind, danger };
  });

  // 4. Carve rooms.
  const tiles: Tile[] = new Array<Tile>(WIDTH * HEIGHT).fill(Tile.Void);
  const setTile = (p: Point, t: Tile): void => {
    tiles[p.y * WIDTH + p.x] = t;
  };
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) setTile({ x, y }, Tile.Floor);
    }
  }

  // 5. Corridors along constellation edges.
  const roomByStar = new Map<number, Room>();
  for (const r of rooms) roomByStar.set(r.starId, r);
  const corridors: Corridor[] = c.edges.map(([a, b]) => {
    const ra = roomByStar.get(a);
    const rb = roomByStar.get(b);
    if (!ra || !rb) throw new Error(`generateDungeon: edge ${a}-${b} references unknown star`);
    const path = lPath(centreOf(ra), centreOf(rb), rng.next() < 0.5);
    return { fromRoom: ra.id, toRoom: rb.id, path };
  });
  for (const cor of corridors) {
    for (const p of cor.path) setTile(p, Tile.Floor);
  }

  // 6. Optional doors where a corridor crosses a room boundary (never inside a room).
  const inAnyRoom = (p: Point): boolean => rooms.some((r) => inRect(r, p));
  const maybeDoor = (p: Point): void => {
    if (!inAnyRoom(p) && rng.next() < 0.5) setTile(p, Tile.Door);
  };
  for (const cor of corridors) {
    const from = rooms[cor.fromRoom];
    const to = rooms[cor.toRoom];
    const leave = cor.path.findIndex((p) => !inRect(from, p));
    if (leave > 0) maybeDoor(cor.path[leave]);
    let enter = -1;
    for (let i = 0; i < cor.path.length; i++) {
      if (!inRect(to, cor.path[i])) enter = i;
    }
    if (enter >= 0 && enter + 1 < cor.path.length) maybeDoor(cor.path[enter]);
  }

  // 7. Walls: every Void tile touching walkable ground (8-adjacency).
  const at = (x: number, y: number): Tile =>
    x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? Tile.Void : tiles[y * WIDTH + x];
  const walls: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (at(x, y) !== Tile.Void) continue;
      let touching = false;
      for (let dy = -1; dy <= 1 && !touching; dy++) {
        for (let dx = -1; dx <= 1 && !touching; dx++) {
          if ((dx || dy) && isWalkable(at(x + dx, y + dy))) touching = true;
        }
      }
      if (touching) walls.push(y * WIDTH + x);
    }
  }
  for (const i of walls) tiles[i] = Tile.Wall;

  // 8. Start and exit in the entrance room.
  const entrance = rooms[0];
  const start = centreOf(entrance);
  const exitCandidates = [
    { x: start.x + 1, y: start.y },
    { x: start.x - 1, y: start.y },
    { x: start.x, y: start.y + 1 },
    { x: start.x, y: start.y - 1 },
  ].filter((p) => inRect(entrance, p));
  const exit = rng.pick(exitCandidates);
  setTile(exit, Tile.Exit);

  // 9. Monsters and treasure.
  const occupied = new Set<string>([key(start), key(exit)]);
  const freeFloor = (room: Rect): Point | undefined => pickFloorTile(tiles, room, occupied, rng);

  const monsters: MonsterSpawn[] = [];
  const treasure: TreasureSpawn[] = [];
  const roster = THEME_MONSTERS[theme];
  for (const room of rooms) {
    if (room.kind === 'normal') {
      const count = rng.int(0, 1) + (room.danger >= 3 ? 1 : 0) + (room.danger >= 5 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const pos = freeFloor(room);
        if (pos) monsters.push({ roomId: room.id, pos, monsterId: rng.pick(roster.minions) });
      }
      const pos = freeFloor(room);
      if (pos) treasure.push({ roomId: room.id, pos, gold: room.danger * rng.int(2, 8) });
    } else if (room.kind === 'boss') {
      const pos = centreOf(room);
      occupied.add(key(pos));
      monsters.push({ roomId: room.id, pos, monsterId: roster.boss });
      const minions = rng.int(1, 2);
      for (let k = 0; k < minions; k++) {
        const mpos = freeFloor(room);
        if (mpos) monsters.push({ roomId: room.id, pos: mpos, monsterId: rng.pick(roster.minions) });
      }
      const tpos = freeFloor(room);
      if (tpos) treasure.push({ roomId: room.id, pos: tpos, gold: 50 + rng.int(0, 50) });
    }
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    tiles,
    rooms,
    corridors,
    start,
    exit,
    monsters,
    treasure,
    theme,
  };
}
