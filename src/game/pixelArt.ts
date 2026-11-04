// Procedural 1-bit sprites. Each glyph is an 8x8 string array: '#' = white, '.' = transparent.
// Rendered at SCALE (2) so every tile is a 16px texture; the camera zooms to 32 screen px.
import type Phaser from 'phaser';
import { MINION_IDS, Tile } from '../core/types';
import type { ClassId, MonsterId } from '../core/types';

export const SCALE = 2;

type Glyph = readonly string[];

const WALL: Glyph = [
  '########',
  '...#....',
  '...#....',
  '########',
  '#...#...',
  '#...#...',
  '########',
  '........',
];

const FLOOR: Glyph = [
  '........',
  '........',
  '.#......',
  '........',
  '......#.',
  '........',
  '...#....',
  '........',
];

const DOOR: Glyph = [
  '########',
  '#......#',
  '#.####.#',
  '#.#..#.#',
  '#.#..#.#',
  '#.####.#',
  '#......#',
  '########',
];

/** Stairs climbing up and to the right. */
const EXIT: Glyph = [
  '#.......',
  '##......',
  '###.....',
  '####....',
  '#####...',
  '########',
  '........',
  '........',
];

// ---------- Heroes: shared body with a class-specific weapon overlay ----------

const HERO_BODY: Glyph = [
  '..##....',
  '..##....',
  '.####...',
  '..##....',
  '..##....',
  '.#..#...',
  '.#..#...',
  '##..##..',
];

const WEAPON_SWORD: Glyph = [
  '......#.',
  '......#.',
  '......#.',
  '.....###',
  '......#.',
  '........',
  '........',
  '........',
];

const WEAPON_DAGGER: Glyph = [
  '........',
  '........',
  '......#.',
  '.....##.',
  '........',
  '........',
  '........',
  '........',
];

const WEAPON_MACE: Glyph = [
  '.....##.',
  '....####',
  '.....##.',
  '......#.',
  '......#.',
  '........',
  '........',
  '........',
];

const WEAPON_STAFF: Glyph = [
  '....###.',
  '.....#..',
  '.....#..',
  '.....#..',
  '.....#..',
  '.....#..',
  '.....#..',
  '.....#..',
];

const HEROES: Record<ClassId, Glyph> = {
  fighter: overlay(HERO_BODY, WEAPON_SWORD),
  thief: overlay(HERO_BODY, WEAPON_DAGGER),
  priest: overlay(HERO_BODY, WEAPON_MACE),
  wizard: overlay(HERO_BODY, WEAPON_STAFF),
};

// ---------- Minions and bosses ----------

const MINIONS: Record<(typeof MINION_IDS)[number], Glyph> = {
  rat: [
    '........',
    '........',
    '.##.....',
    '#####...',
    '#######.',
    '.##.##..',
    '........',
    '........',
  ],
  skeleton: [
    '..###...',
    '.#.#.#..',
    '..###...',
    '...#....',
    '.#####..',
    '..#.#...',
    '..#.#...',
    '.##.##..',
  ],
  goblin: [
    '#.....#.',
    '##...##.',
    '.#####..',
    '.#.#.#..',
    '.#####..',
    '..###...',
    '.#...#..',
    '.#...#..',
  ],
  cultist: [
    '..###...',
    '.#####..',
    '.#...#..',
    '.#####..',
    '.#####..',
    '#######.',
    '#.#.#.#.',
    '########',
  ],
  wolf: [
    '........',
    '##......',
    '#####...',
    '########',
    '#######.',
    '#.#.#.#.',
    '#.#.#.#.',
    '........',
  ],
  'giant-snake': [
    '........',
    '.#####..',
    '#.....#.',
    '#.###.#.',
    '#.#...#.',
    '#.#####.',
    '#.......',
    '#######.',
  ],
  shade: [
    '..###...',
    '.#####..',
    '.#.#.#..',
    '.#####..',
    '.#####..',
    '.#####..',
    '.#.#.#..',
    '.#...#..',
  ],
  'gelatinous-cube': [
    '########',
    '#......#',
    '#.#..#.#',
    '#......#',
    '#.#..#.#',
    '#......#',
    '########',
    '........',
  ],
};

/** One generic boss glyph, drawn at 2x the tile size (32px). */
const BOSS: Glyph = [
  '#.#.#.#.',
  '########',
  '.######.',
  '.#.##.#.',
  '.######.',
  '..####..',
  '.#.##.#.',
  '........',
];

const GOLD: Glyph = [
  '........',
  '..####..',
  '.#....#.',
  '.#.##.#.',
  '.#.##.#.',
  '.#....#.',
  '..####..',
  '........',
];

const TORCH: Glyph = [
  '...#....',
  '..###...',
  '..###...',
  '...#....',
  '...#....',
  '...#....',
  '...#....',
  '........',
];

// ---------- Keys ----------

const TILE_KEYS = { wall: 'tile-wall', floor: 'tile-floor', door: 'tile-door', exit: 'tile-exit' } as const;

export const TEXTURE = {
  tile: TILE_KEYS,
  hero: (c: ClassId): string => `hero-${c}`,
  monster: (id: MonsterId): string => `mon-${id}`,
  boss: 'boss',
  gold: 'gold',
  torch: 'torch',
} as const;

/** Texture key for a dungeon tile type (Void has none). */
export function tileTextureKey(t: Tile): string | undefined {
  switch (t) {
    case Tile.Floor: return TILE_KEYS.floor;
    case Tile.Wall: return TILE_KEYS.wall;
    case Tile.Door: return TILE_KEYS.door;
    case Tile.Exit: return TILE_KEYS.exit;
    default: return undefined;
  }
}

function overlay(base: Glyph, extra: Glyph): Glyph {
  return base.map((row, y) => Array.from(row, (ch, x) => (ch === '#' || extra[y][x] === '#' ? '#' : '.')).join(''));
}

/** Draws a glyph into a new texture. Skips if the key already exists. */
function bake(scene: Phaser.Scene, key: string, glyph: Glyph, scale = SCALE): void {
  if (scene.textures.exists(key)) return;
  const h = glyph.length;
  const w = glyph[0].length;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (glyph[y][x] === '#') g.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  g.generateTexture(key, w * scale, h * scale);
  g.destroy();
}

/** Creates every dungeon texture. Safe to call more than once. */
export function createPixelTextures(scene: Phaser.Scene): void {
  bake(scene, TILE_KEYS.wall, WALL);
  bake(scene, TILE_KEYS.floor, FLOOR);
  bake(scene, TILE_KEYS.door, DOOR);
  bake(scene, TILE_KEYS.exit, EXIT);
  for (const c of Object.keys(HEROES) as ClassId[]) bake(scene, TEXTURE.hero(c), HEROES[c]);
  for (const id of MINION_IDS) bake(scene, TEXTURE.monster(id), MINIONS[id]);
  // All bosses share one generic glyph, drawn at 2x size.
  bake(scene, TEXTURE.boss, BOSS, SCALE * 2);
  bake(scene, TEXTURE.gold, GOLD);
  bake(scene, TEXTURE.torch, TORCH);
}

/** Texture key for a monster: minions have their own sprite, bosses share the big glyph. */
export function monsterTextureKey(id: MonsterId, isBoss: boolean): string {
  return isBoss ? TEXTURE.boss : TEXTURE.monster(id);
}
