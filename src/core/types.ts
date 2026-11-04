// Shared contracts for Star Crawler. Pure data — no Phaser imports anywhere under src/core.
// Changing anything here affects every module; coordinate before editing.

// ---------- Geometry / RNG ----------
export interface Point { x: number; y: number }

/** Seeded RNG (implemented in src/core/rng.ts). */
export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

// ---------- Sky & constellations ----------
export interface Star {
  id: number;
  /** normalised sky coords, 0..1 */
  x: number;
  y: number;
  /** 1 (dim) .. 5 (brightest) */
  brightness: number;
}

export interface Sky { seed: number; stars: Star[] }

/** What the player drew. starIds are in the order first touched; starIds[0] is the entrance. */
export interface Constellation {
  starIds: number[];
  /** undirected, no duplicates, each pair of star ids */
  edges: Array<[number, number]>;
}

export const MIN_STARS = 4;
export const MAX_STARS = 10;

export type ThemeId = 'serpent' | 'crown' | 'hound' | 'archer' | 'chalice' | 'unnamed';

export interface ConstellationMatch {
  theme: ThemeId;
  /** display name, e.g. "The Serpent" */
  name: string;
  /** 0..1 similarity; 'unnamed' when best score < threshold */
  score: number;
}

// ---------- Monsters per theme (shared by generator + rules) ----------
export const MINION_IDS = ['rat', 'skeleton', 'goblin', 'cultist', 'wolf', 'giant-snake', 'shade', 'gelatinous-cube'] as const;
export const BOSS_IDS = ['serpent-queen', 'crowned-lich', 'hellhound', 'shadow-archer', 'chalice-wraith', 'nameless-horror'] as const;
export type MonsterId = typeof MINION_IDS[number] | typeof BOSS_IDS[number];

export const THEME_MONSTERS: Record<ThemeId, { minions: MonsterId[]; boss: MonsterId }> = {
  serpent: { minions: ['rat', 'giant-snake', 'cultist'], boss: 'serpent-queen' },
  crown:   { minions: ['skeleton', 'cultist', 'shade'], boss: 'crowned-lich' },
  hound:   { minions: ['wolf', 'goblin', 'rat'], boss: 'hellhound' },
  archer:  { minions: ['goblin', 'skeleton', 'shade'], boss: 'shadow-archer' },
  chalice: { minions: ['cultist', 'gelatinous-cube', 'shade'], boss: 'chalice-wraith' },
  unnamed: { minions: ['rat', 'goblin', 'skeleton'], boss: 'nameless-horror' },
};

// ---------- Dungeon ----------
export enum Tile { Void = 0, Floor = 1, Wall = 2, Door = 3, Exit = 4 }

export type RoomKind = 'entrance' | 'normal' | 'boss';

export interface Room {
  id: number;
  starId: number;
  /** tile-space rectangle of floor (walls surround it) */
  x: number; y: number; w: number; h: number;
  kind: RoomKind;
  /** 1..5, from star brightness */
  danger: number;
}

export interface Corridor { fromRoom: number; toRoom: number; path: Point[] }

export interface MonsterSpawn { roomId: number; pos: Point; monsterId: MonsterId }
export interface TreasureSpawn { roomId: number; pos: Point; gold: number }

export interface DungeonMap {
  width: number;
  height: number;
  /** row-major, index = y * width + x, values are Tile */
  tiles: Tile[];
  rooms: Room[];
  corridors: Corridor[];
  /** hero start (inside entrance room) */
  start: Point;
  /** Exit tile location (inside entrance room) — stepping here returns to camp */
  exit: Point;
  monsters: MonsterSpawn[];
  treasure: TreasureSpawn[];
  theme: ThemeId;
}

// ---------- Rules (Shadowdark-style, 5e-lite) ----------
export type Ability = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export type Stats = Record<Ability, number>;
export type ClassId = 'fighter' | 'thief' | 'priest' | 'wizard';

export interface AttackDef {
  name: string;
  ability: Ability;      // modifier added to hit and damage
  damage: string;        // dice expression, e.g. "1d8", "2d4+1"
  range: number;         // in squares; 1 = melee
}

export interface Creature {
  id: string;
  name: string;
  stats: Stats;
  hp: number;
  maxHp: number;
  ac: number;
  /** squares per turn (Shadowdark "near" ≈ 6) */
  speed: number;
  attacks: AttackDef[];
  pos: Point;
  level: number;
}

export type SpellId = 'magic-missile' | 'sleep' | 'cure-wounds' | 'turn-undead' | 'light';

export interface Hero extends Creature {
  classId: ClassId;
  xp: number;
  /** gold banked at camp (safe) */
  gold: number;
  /** gold carried in the current dungeon (lost on death) */
  carriedGold: number;
  spells: SpellId[];
  /** spells lost after failed casts until long rest */
  lostSpells: SpellId[];
  injuries: string[];
  /** torches in pack */
  torches: number;
}

export interface Monster extends Creature {
  monsterId: MonsterId;
  xpValue: number;
  /** 'chase' moves toward hero; 'ranged' keeps distance */
  behaviour: 'chase' | 'ranged';
  undead: boolean;
  /** true while under Sleep; skips turns, wakes when damaged */
  sleeping: boolean;
  isBoss: boolean;
}

export interface AttackResult {
  roll: number;          // natural d20
  total: number;
  hit: boolean;
  crit: boolean;         // natural 20
  damage: number;        // 0 on miss
  log: string;           // human-readable line for the combat log
}

/** Torch burns 1 per hero turn in the dungeon. */
export const TORCH_TURNS = 60;

/** Data passed from SkyScene to DungeonScene via scene.start('Dungeon', data). */
export interface DungeonSceneData {
  sky: Sky;
  constellation: Constellation;
  match: ConstellationMatch;
}

// ---------- Campaign ----------
export interface CampaignState {
  version: 1;
  hero: Hero;
  /** number of dungeons completed */
  delves: number;
  /** seed for the next sky */
  nextSkySeed: number;
  /** themes the player has discovered */
  discovered: ThemeId[];
}
