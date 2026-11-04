import { describe, it, expect } from 'vitest';
import type { AttackDef, Creature, Hero, Rng, Stats } from './types';
import { createRng } from './rng';
import { createMonster } from './monsters';
import {
  CLASS_INFO,
  abilityMod,
  applyDamage,
  attackBonus,
  createHero,
  distance,
  goldToXp,
  grantXp,
  longRest,
  resolveAttack,
  xpToNext,
} from './rules';

/** Rng that returns scripted int() values in order and fails on over-draw or out-of-range values. */
function scripted(values: number[]): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: (min, max) => {
      const v = values[i++];
      if (v === undefined) throw new Error('scripted rng exhausted');
      if (v < min || v > max) throw new Error(`scripted ${v} outside [${min}, ${max}]`);
      return v;
    },
    pick: (items) => items[0],
  };
}

const stats = (over: Partial<Stats> = {}): Stats => ({
  STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10, ...over,
});

function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'c',
    name: 'Goblin',
    stats: stats({ STR: 14 }),
    hp: 10,
    maxHp: 10,
    ac: 13,
    speed: 6,
    attacks: [],
    pos: { x: 0, y: 0 },
    level: 2,
    ...over,
  };
}

const SPEAR: AttackDef = { name: 'Spear', ability: 'STR', damage: '1d6', range: 1 };

describe('abilityMod', () => {
  it.each([
    [1, -4], [3, -4], [4, -3], [5, -3], [6, -2], [7, -2], [8, -1], [9, -1],
    [10, 0], [11, 0], [12, 1], [13, 1], [14, 2], [15, 2], [16, 3], [17, 3],
    [18, 4], [20, 4],
  ])('score %i -> %i', (score, mod) => {
    expect(abilityMod(score)).toBe(mod);
  });
});

describe('distance', () => {
  it('uses Chebyshev distance with diagonals = 1', () => {
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('resolveAttack', () => {
  // STR 14 -> +2, level 2 monster -> attackBonus +1, so total = roll + 3
  const attacker = creature();

  it('natural 20 hits and crits, doubling damage dice', () => {
    const target = creature({ name: 'Aria', ac: 25 });
    const r = resolveAttack(attacker, target, SPEAR, scripted([20, 3, 4]));
    expect(r.roll).toBe(20);
    expect(r.crit).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.damage).toBe(9); // 3 + 4 + 2
  });

  it('natural 1 always misses, even if the total would hit', () => {
    const target = creature({ name: 'Aria', ac: 2 });
    const r = resolveAttack(attacker, target, SPEAR, scripted([1]));
    expect(r.roll).toBe(1);
    expect(r.hit).toBe(false);
    expect(r.crit).toBe(false);
    expect(r.damage).toBe(0);
  });

  it('hits when total meets AC, with damage = dice + mod', () => {
    const target = creature({ name: 'Aria', ac: 13 });
    const r = resolveAttack(attacker, target, SPEAR, scripted([12, 4]));
    expect(r.total).toBe(15);
    expect(r.hit).toBe(true);
    expect(r.damage).toBe(6);
    expect(r.log).toBe('Goblin hits Aria with Spear (15 vs AC 13) for 6.');
  });

  it('misses when total is below AC', () => {
    const target = creature({ name: 'Aria', ac: 13 });
    const r = resolveAttack(attacker, target, SPEAR, scripted([5]));
    expect(r.hit).toBe(false);
    expect(r.log).toBe('Goblin misses Aria with Spear (8 vs AC 13).');
  });

  it('minimum damage on hit is 1', () => {
    const weak = creature({ stats: stats({ STR: 1 }), level: 0 });
    const target = creature({ name: 'Aria', ac: 5 });
    const r = resolveAttack(weak, target, SPEAR, scripted([12, 1]));
    expect(r.hit).toBe(true);
    expect(r.damage).toBe(1);
  });

  it('gives advantage against a sleeping monster target', () => {
    const sleeper = createMonster('goblin', { x: 1, y: 0 }, createRng(1), 'g1');
    sleeper.sleeping = true;
    sleeper.ac = 16;
    // rolls 5 and 15 -> advantage keeps 15: total 18 >= 16
    const r = resolveAttack(attacker, sleeper, SPEAR, scripted([5, 15, 3]));
    expect(r.roll).toBe(15);
    expect(r.hit).toBe(true);
  });

  it('advantage and disadvantage cancel out', () => {
    const sleeper = createMonster('goblin', { x: 1, y: 0 }, createRng(1), 'g1');
    sleeper.sleeping = true;
    const r = resolveAttack(attacker, sleeper, SPEAR, scripted([5]), 'disadvantage');
    expect(r.roll).toBe(5);
  });

  it('does not mutate attacker or target', () => {
    const target = creature({ name: 'Aria', ac: 13 });
    const a0 = structuredClone(attacker);
    const t0 = structuredClone(target);
    resolveAttack(attacker, target, SPEAR, scripted([12, 4]));
    expect(attacker).toEqual(a0);
    expect(target).toEqual(t0);
  });
});

describe('applyDamage', () => {
  it('reduces hp and floors at 0', () => {
    const c = creature({ hp: 5 });
    expect(applyDamage(c, 3)).toBe(false);
    expect(c.hp).toBe(2);
    expect(applyDamage(c, 99)).toBe(true);
    expect(c.hp).toBe(0);
  });

  it('wakes a sleeping monster when damaged', () => {
    const m = createMonster('rat', { x: 0, y: 0 }, createRng(1), 'r1');
    m.sleeping = true;
    m.hp = 4;
    applyDamage(m, 1);
    expect(m.sleeping).toBe(false);
  });
});

describe('attackBonus', () => {
  const hero = (classId: Hero['classId'], level: number): Hero => {
    const h = createHero('T', classId, createRng(1));
    h.level = level;
    return h;
  };

  it('fighters: +1 at 1-2, +2 at 3-5, +3 at 6+', () => {
    expect(attackBonus(hero('fighter', 1))).toBe(1);
    expect(attackBonus(hero('fighter', 2))).toBe(1);
    expect(attackBonus(hero('fighter', 3))).toBe(2);
    expect(attackBonus(hero('fighter', 5))).toBe(2);
    expect(attackBonus(hero('fighter', 6))).toBe(3);
  });

  it('other classes: +0 at 1-4, +1 at 5+', () => {
    expect(attackBonus(hero('thief', 4))).toBe(0);
    expect(attackBonus(hero('wizard', 5))).toBe(1);
    expect(attackBonus(hero('priest', 9))).toBe(1);
  });

  it('monsters use level / 2 floored', () => {
    expect(attackBonus(creature({ level: 1 }))).toBe(0);
    expect(attackBonus(creature({ level: 3 }))).toBe(1);
    expect(attackBonus(creature({ level: 4 }))).toBe(2);
  });
});

describe('createHero', () => {
  it('rerolls all stats until one is >= 14', () => {
    // First attempt: six stats of 3d6 = 9 each (no 14+). Second attempt: STR 18, rest 9.
    const seq = [...Array(18).fill(3), 6, 6, 6, ...Array(15).fill(3)];
    const h = createHero('Aria', 'fighter', scripted(seq));
    expect(h.stats).toEqual({ STR: 18, DEX: 9, CON: 9, INT: 9, WIS: 9, CHA: 9 });
  });

  it.each(['fighter', 'thief', 'priest', 'wizard'] as const)('builds a valid %s', (classId) => {
    for (let seed = 1; seed <= 25; seed++) {
      const h = createHero('Aria', classId, createRng(seed));
      const values = Object.values(h.stats);
      expect(values.length).toBe(6);
      expect(values.some((v) => v >= 14)).toBe(true);
      expect(values.every((v) => v >= 3 && v <= 18)).toBe(true);

      const hpBase = CLASS_INFO[classId].hitDie;
      expect(h.maxHp).toBe(Math.max(1, hpBase + abilityMod(h.stats.CON)));
      expect(h.hp).toBe(h.maxHp);
      expect(h.level).toBe(1);
      expect(h.xp).toBe(0);
      expect(h.gold).toBe(0);
      expect(h.carriedGold).toBe(0);
      expect(h.lostSpells).toEqual([]);
      expect(h.injuries).toEqual([]);
      expect(h.torches).toBe(3);
      expect(h.speed).toBe(6);
      expect(h.pos).toEqual({ x: 0, y: 0 });
      expect(h.classId).toBe(classId);
    }
  });

  it('applies class AC base + DEX mod and class attacks', () => {
    const rng = createRng(9);
    const f = createHero('F', 'fighter', rng);
    expect(f.ac).toBe(14 + abilityMod(f.stats.DEX));
    expect(f.attacks).toEqual([{ name: 'Longsword', ability: 'STR', damage: '1d8', range: 1 }]);

    const t = createHero('T', 'thief', rng);
    expect(t.ac).toBe(11 + abilityMod(t.stats.DEX));
    expect(t.attacks.map((a) => [a.name, a.ability, a.damage, a.range])).toEqual([
      ['Shortsword', 'DEX', '1d6', 1],
      ['Shortbow', 'DEX', '1d4', 8],
    ]);

    const p = createHero('P', 'priest', rng);
    expect(p.ac).toBe(13 + abilityMod(p.stats.DEX));
    expect(p.attacks).toEqual([{ name: 'Mace', ability: 'STR', damage: '1d6', range: 1 }]);
    expect(p.spells).toEqual(['cure-wounds', 'turn-undead']);

    const w = createHero('W', 'wizard', rng);
    expect(w.ac).toBe(10 + abilityMod(w.stats.DEX));
    expect(w.attacks).toEqual([{ name: 'Dagger', ability: 'DEX', damage: '1d4', range: 1 }]);
    expect(w.spells).toEqual(['magic-missile', 'sleep', 'light']);
  });

  it('non-casters have no spells', () => {
    expect(createHero('F', 'fighter', createRng(2)).spells).toEqual([]);
    expect(createHero('T', 'thief', createRng(2)).spells).toEqual([]);
  });

  it('exposes hit dice 8/4/6/4', () => {
    expect(CLASS_INFO.fighter.hitDie).toBe(8);
    expect(CLASS_INFO.thief.hitDie).toBe(4);
    expect(CLASS_INFO.priest.hitDie).toBe(6);
    expect(CLASS_INFO.wizard.hitDie).toBe(4);
  });
});

describe('XP and levels', () => {
  const fighter = (con = 10): Hero => {
    const h = createHero('Aria', 'fighter', createRng(4));
    h.stats = { ...h.stats, CON: con };
    h.maxHp = 10;
    h.hp = 10;
    h.xp = 0;
    h.level = 1;
    return h;
  };

  it('xpToNext(level) = level * 10', () => {
    expect(xpToNext(1)).toBe(10);
    expect(xpToNext(3)).toBe(30);
  });

  it('single level-up subtracts cost and adds HP', () => {
    const h = fighter(10); // CON mod 0
    const log = grantXp(h, 12, scripted([5]));
    expect(h.level).toBe(2);
    expect(h.xp).toBe(2);
    expect(h.maxHp).toBe(15);
    expect(h.hp).toBe(15);
    expect(log.length).toBe(2);
  });

  it('levels up repeatedly in one grant', () => {
    const h = fighter(10);
    // 35 xp: L1 costs 10 -> 25; L2 costs 20 -> 5; stops at L3
    const log = grantXp(h, 35, scripted([4, 4]));
    expect(h.level).toBe(3);
    expect(h.xp).toBe(5);
    expect(h.maxHp).toBe(18);
    expect(h.hp).toBe(18);
    expect(log.length).toBe(3);
  });

  it('applies CON modifier to HP gain', () => {
    const h = fighter(14); // CON mod +2
    grantXp(h, 10, scripted([3]));
    expect(h.maxHp).toBe(15); // 10 + max(1, 3 + 2)
  });

  it('HP gain is at least 1', () => {
    const h = fighter(1); // CON mod -4
    grantXp(h, 10, scripted([1]));
    expect(h.maxHp).toBe(11);
  });

  it('caps level at 10', () => {
    const h = fighter(10);
    h.level = 10;
    h.xp = 0;
    grantXp(h, 1000, scripted([]));
    expect(h.level).toBe(10);
    expect(h.xp).toBe(1000);
  });

  it('goldToXp is floor(gold / 10)', () => {
    expect(goldToXp(25)).toBe(2);
    expect(goldToXp(9)).toBe(0);
  });

  it('longRest restores hp and clears lost spells', () => {
    const h = createHero('W', 'wizard', createRng(6));
    h.hp = 1;
    h.lostSpells = ['sleep'];
    longRest(h);
    expect(h.hp).toBe(h.maxHp);
    expect(h.lostSpells).toEqual([]);
  });
});
