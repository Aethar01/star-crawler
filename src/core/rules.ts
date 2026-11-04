import type {
  Ability,
  AttackDef,
  AttackResult,
  ClassId,
  Creature,
  Hero,
  Monster,
  Point,
  Rng,
  SpellId,
  Stats,
} from './types';
import { rollD20, rollDice } from './dice';

type RollMode = 'normal' | 'advantage' | 'disadvantage';

const ABILITIES: Ability[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const MAX_LEVEL = 10;

export const CLASS_INFO: Record<ClassId, { name: string; hitDie: number; description: string }> = {
  fighter: { name: 'Fighter', hitDie: 8, description: 'Sturdy frontline warrior with a longsword.' },
  thief: { name: 'Thief', hitDie: 4, description: 'Nimble scout who strikes with a blade or bow.' },
  priest: { name: 'Priest', hitDie: 6, description: 'Devout healer who turns the undead.' },
  wizard: { name: 'Wizard', hitDie: 4, description: 'Fragile caster of missiles, sleep and light.' },
};

const CLASS_KIT: Record<ClassId, { acBase: number; attacks: AttackDef[]; spells: SpellId[] }> = {
  fighter: {
    acBase: 14,
    attacks: [{ name: 'Longsword', ability: 'STR', damage: '1d8', range: 1 }],
    spells: [],
  },
  thief: {
    acBase: 11,
    attacks: [
      { name: 'Shortsword', ability: 'DEX', damage: '1d6', range: 1 },
      { name: 'Shortbow', ability: 'DEX', damage: '1d4', range: 8 },
    ],
    spells: [],
  },
  priest: {
    acBase: 13,
    attacks: [{ name: 'Mace', ability: 'STR', damage: '1d6', range: 1 }],
    spells: ['cure-wounds', 'turn-undead'],
  },
  wizard: {
    acBase: 10,
    attacks: [{ name: 'Dagger', ability: 'DEX', damage: '1d4', range: 1 }],
    spells: ['magic-missile', 'sleep', 'light'],
  },
};

/** Modifier for an ability score (3..18+ range, table per Shadowdark-lite). */
export function abilityMod(score: number): number {
  if (score <= 3) return -4;
  if (score <= 5) return -3;
  if (score <= 7) return -2;
  if (score <= 9) return -1;
  if (score <= 11) return 0;
  if (score <= 13) return 1;
  if (score <= 15) return 2;
  if (score <= 17) return 3;
  return 4;
}

/** Chebyshev distance: diagonal steps count as one square. */
export function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function rollInitiative(c: Creature, rng: Rng): number {
  return rollD20(rng) + abilityMod(c.stats.DEX);
}

/** Attack bonus added to attack rolls. Heroes by class and level; monsters use level / 2 (floored). */
export function attackBonus(c: Creature): number {
  if (!('classId' in c)) return Math.floor(c.level / 2);
  const hero = c as Hero;
  if (hero.classId === 'fighter') {
    if (hero.level >= 6) return 3;
    if (hero.level >= 3) return 2;
    return 1;
  }
  return hero.level >= 5 ? 1 : 0;
}

/**
 * Resolves an attack without mutating either creature.
 * Sleeping monster targets grant advantage; advantage and disadvantage cancel.
 */
export function resolveAttack(
  attacker: Creature,
  target: Creature,
  attack: AttackDef,
  rng: Rng,
  mode: RollMode = 'normal',
): AttackResult {
  const sleeping = 'sleeping' in target && target.sleeping === true;
  const adv = mode === 'advantage' || sleeping;
  const dis = mode === 'disadvantage';
  const effective: RollMode = adv && !dis ? 'advantage' : dis && !adv ? 'disadvantage' : 'normal';

  const roll = rollD20(rng, effective);
  const crit = roll === 20;
  const mod = abilityMod(attacker.stats[attack.ability]);
  const total = roll + mod + attackBonus(attacker);
  const hit = roll !== 1 && (crit || total >= target.ac);
  const damage = hit ? Math.max(1, rollDice(attack.damage, rng, crit) + mod) : 0;

  const log = hit
    ? `${attacker.name} hits ${target.name} with ${attack.name} (${total} vs AC ${target.ac}) for ${damage}.`
    : `${attacker.name} misses ${target.name} with ${attack.name} (${total} vs AC ${target.ac}).`;

  return { roll, total, hit, crit, damage, log };
}

/** Mutates hp (floored at 0). Wakes sleeping monsters when damaged. Returns true if this hit dropped target to 0. */
export function applyDamage(target: Creature, dmg: number): boolean {
  const amount = Math.max(0, dmg);
  const before = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  if (amount > 0 && 'sleeping' in target) (target as Monster).sleeping = false;
  return before > 0 && target.hp === 0;
}

export function createHero(name: string, classId: ClassId, rng: Rng): Hero {
  const roll3d6 = (): number => rng.int(1, 6) + rng.int(1, 6) + rng.int(1, 6);

  const stats = {} as Stats;
  do {
    for (const a of ABILITIES) stats[a] = roll3d6();
  } while (!ABILITIES.some((a) => stats[a] >= 14));

  const kit = CLASS_KIT[classId];
  const hpBase = CLASS_INFO[classId].hitDie;
  const hp = Math.max(1, hpBase + abilityMod(stats.CON));

  return {
    id: 'hero',
    name,
    classId,
    stats,
    hp,
    maxHp: hp,
    ac: kit.acBase + abilityMod(stats.DEX),
    speed: 6,
    attacks: kit.attacks.map((a) => ({ ...a })),
    pos: { x: 0, y: 0 },
    level: 1,
    xp: 0,
    gold: 0,
    carriedGold: 0,
    spells: [...kit.spells],
    lostSpells: [],
    injuries: [],
    torches: 3,
  };
}

export function xpToNext(level: number): number {
  return level * 10;
}

/** Adds xp and levels up while enough xp is banked (cost is subtracted; level capped at 10). */
export function grantXp(hero: Hero, xp: number, rng: Rng): string[] {
  const log: string[] = [];
  hero.xp += xp;
  log.push(`${hero.name} gains ${xp} XP.`);

  const hitDie = CLASS_INFO[hero.classId].hitDie;
  while (hero.level < MAX_LEVEL && hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level += 1;
    const gain = Math.max(1, rng.int(1, hitDie) + abilityMod(hero.stats.CON));
    hero.maxHp += gain;
    hero.hp += gain;
    log.push(`${hero.name} reaches level ${hero.level}! (+${gain} max HP)`);
  }
  return log;
}

export function goldToXp(gold: number): number {
  return Math.floor(gold / 10);
}

export function longRest(hero: Hero): void {
  hero.hp = hero.maxHp;
  hero.lostSpells = [];
}
