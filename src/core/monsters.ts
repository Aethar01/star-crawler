import type { AttackDef, Monster, MonsterId, Point, Rng, Stats } from './types';
import { rollDice } from './dice';

export interface MonsterDef {
  name: string;
  stats: Stats;
  /** dice expression for max HP, e.g. "2d6" or "5d8+10" */
  hp: string;
  ac: number;
  speed: number;
  attacks: AttackDef[];
  level: number;
  xpValue: number;
  behaviour: Monster['behaviour'];
  undead: boolean;
  isBoss: boolean;
}

const S = (STR: number, DEX: number, CON: number, INT: number, WIS: number, CHA: number): Stats =>
  ({ STR, DEX, CON, INT, WIS, CHA });

export const MONSTERS: Record<MonsterId, MonsterDef> = {
  // ---------- Minions ----------
  rat: {
    name: 'Rat',
    stats: S(2, 14, 8, 2, 10, 2),
    hp: '1d4', ac: 10, speed: 6,
    attacks: [{ name: 'Bite', ability: 'DEX', damage: '1d3', range: 1 }],
    level: 1, xpValue: 2, behaviour: 'chase', undead: false, isBoss: false,
  },
  skeleton: {
    name: 'Skeleton',
    stats: S(14, 12, 12, 2, 8, 2),
    hp: '2d6', ac: 13, speed: 6,
    attacks: [{ name: 'Rusty Blade', ability: 'STR', damage: '1d6', range: 1 }],
    level: 2, xpValue: 5, behaviour: 'chase', undead: true, isBoss: false,
  },
  goblin: {
    name: 'Goblin',
    stats: S(8, 14, 10, 10, 8, 8),
    hp: '1d6', ac: 13, speed: 6,
    attacks: [
      { name: 'Short Sword', ability: 'DEX', damage: '1d6', range: 1 },
      { name: 'Javelin', ability: 'STR', damage: '1d4', range: 4 },
    ],
    level: 1, xpValue: 3, behaviour: 'chase', undead: false, isBoss: false,
  },
  cultist: {
    name: 'Cultist',
    stats: S(10, 10, 10, 12, 14, 10),
    hp: '2d6', ac: 11, speed: 6,
    attacks: [
      { name: 'Dagger', ability: 'WIS', damage: '1d4', range: 1 },
      { name: 'Dark Bolt', ability: 'WIS', damage: '1d6', range: 5 },
    ],
    level: 2, xpValue: 5, behaviour: 'chase', undead: false, isBoss: false,
  },
  wolf: {
    name: 'Wolf',
    stats: S(14, 14, 12, 3, 12, 6),
    hp: '2d8', ac: 12, speed: 8,
    attacks: [{ name: 'Bite', ability: 'STR', damage: '1d6', range: 1 }],
    level: 2, xpValue: 5, behaviour: 'chase', undead: false, isBoss: false,
  },
  'giant-snake': {
    name: 'Giant Snake',
    stats: S(10, 16, 12, 1, 10, 2),
    hp: '3d6', ac: 13, speed: 6,
    attacks: [{ name: 'Fanged Bite', ability: 'DEX', damage: '1d6', range: 1 }],
    level: 3, xpValue: 8, behaviour: 'chase', undead: false, isBoss: false,
  },
  shade: {
    name: 'Shade',
    stats: S(6, 14, 12, 6, 10, 12),
    hp: '3d6', ac: 12, speed: 6,
    attacks: [{ name: 'Chill Touch', ability: 'DEX', damage: '1d6', range: 1 }],
    level: 3, xpValue: 8, behaviour: 'chase', undead: true, isBoss: false,
  },
  'gelatinous-cube': {
    name: 'Gelatinous Cube',
    stats: S(14, 4, 16, 1, 4, 1),
    hp: '4d8', ac: 8, speed: 4,
    attacks: [{ name: 'Pseudopod', ability: 'STR', damage: '2d4', range: 1 }],
    level: 3, xpValue: 10, behaviour: 'chase', undead: false, isBoss: false,
  },

  // ---------- Bosses ----------
  'serpent-queen': {
    name: 'Serpent Queen',
    stats: S(14, 16, 14, 12, 14, 16),
    hp: '6d6+10', ac: 14, speed: 6,
    attacks: [
      { name: 'Venom Fang', ability: 'DEX', damage: '1d8', range: 1 },
      { name: 'Coils', ability: 'STR', damage: '1d6', range: 1 },
    ],
    level: 4, xpValue: 25, behaviour: 'chase', undead: false, isBoss: true,
  },
  'crowned-lich': {
    name: 'Crowned Lich',
    stats: S(8, 12, 12, 18, 16, 16),
    hp: '5d8+10', ac: 15, speed: 6,
    attacks: [
      { name: 'Withering Touch', ability: 'INT', damage: '2d6', range: 1 },
      { name: 'Grave Chill', ability: 'WIS', damage: '1d6', range: 1 },
    ],
    level: 5, xpValue: 30, behaviour: 'chase', undead: true, isBoss: true,
  },
  hellhound: {
    name: 'Hellhound',
    stats: S(16, 16, 14, 6, 12, 8),
    hp: '6d6+6', ac: 14, speed: 8,
    attacks: [
      { name: 'Bite', ability: 'STR', damage: '2d6', range: 1 },
      { name: 'Claw', ability: 'DEX', damage: '1d6', range: 1 },
    ],
    level: 5, xpValue: 25, behaviour: 'chase', undead: false, isBoss: true,
  },
  'shadow-archer': {
    name: 'Shadow Archer',
    stats: S(10, 16, 12, 12, 12, 8),
    hp: '5d6+8', ac: 13, speed: 6,
    attacks: [
      { name: 'Shadow Bow', ability: 'DEX', damage: '1d8', range: 8 },
      { name: 'Dagger', ability: 'DEX', damage: '1d4', range: 1 },
    ],
    level: 4, xpValue: 25, behaviour: 'ranged', undead: false, isBoss: true,
  },
  'chalice-wraith': {
    name: 'Chalice Wraith',
    stats: S(6, 14, 12, 10, 14, 18),
    hp: '5d8+8', ac: 14, speed: 6,
    attacks: [
      { name: 'Soul Drain', ability: 'CHA', damage: '2d6', range: 1 },
      { name: 'Chill Claw', ability: 'DEX', damage: '1d6', range: 1 },
    ],
    level: 5, xpValue: 28, behaviour: 'chase', undead: true, isBoss: true,
  },
  'nameless-horror': {
    name: 'Nameless Horror',
    stats: S(18, 8, 16, 4, 10, 4),
    hp: '5d8+12', ac: 15, speed: 6,
    attacks: [
      { name: 'Tentacle', ability: 'STR', damage: '2d6', range: 1 },
      { name: 'Maw', ability: 'CON', damage: '1d8', range: 1 },
    ],
    level: 5, xpValue: 30, behaviour: 'chase', undead: false, isBoss: true,
  },
};

/** Instantiates a monster with rolled max HP (min 1), not sleeping. */
export function createMonster(id: MonsterId, pos: Point, rng: Rng, uid: string): Monster {
  const def = MONSTERS[id];
  const hp = Math.max(1, rollDice(def.hp, rng));
  return {
    id: uid,
    monsterId: id,
    name: def.name,
    stats: { ...def.stats },
    hp,
    maxHp: hp,
    ac: def.ac,
    speed: def.speed,
    attacks: def.attacks.map((a) => ({ ...a })),
    pos: { x: pos.x, y: pos.y },
    level: def.level,
    xpValue: def.xpValue,
    behaviour: def.behaviour,
    undead: def.undead,
    sleeping: false,
    isBoss: def.isBoss,
  };
}
