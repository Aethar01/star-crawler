import { describe, it, expect } from 'vitest';
import type { Hero, Rng, SpellId } from './types';
import { createRng } from './rng';
import { createHero } from './rules';
import { createMonster } from './monsters';
import { castSpell } from './spells';

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

function wizard(level = 1): Hero {
  const h = createHero('Mira', 'wizard', createRng(3));
  h.stats = { ...h.stats, INT: 14 }; // +2
  h.level = level;
  h.pos = { x: 0, y: 0 };
  return h;
}

function priest(): Hero {
  const h = createHero('Pell', 'priest', createRng(3));
  h.stats = { ...h.stats, WIS: 12 }; // +1
  h.pos = { x: 0, y: 0 };
  return h;
}

describe('castSpell: gating', () => {
  it('cannot cast a spell the hero does not know (no roll)', () => {
    const h = wizard();
    const r = castSpell(h, 'cure-wounds' as SpellId, { x: 0, y: 0 }, [], scripted([]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(false);
  });

  it('cannot cast a lost spell (no roll)', () => {
    const h = wizard();
    h.lostSpells = ['magic-missile'];
    const r = castSpell(h, 'magic-missile', { x: 1, y: 0 }, [], scripted([]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(false);
  });

  it('rejects out-of-range magic missile without rolling', () => {
    const h = wizard();
    const r = castSpell(h, 'magic-missile', { x: 9, y: 0 }, [], scripted([]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(false);
  });
});

describe('castSpell: spellcasting check', () => {
  it('failed check loses the spell until long rest', () => {
    const h = wizard();
    const m = createMonster('rat', { x: 1, y: 0 }, createRng(1), 'r1');
    const hp0 = m.hp;
    // roll 5 + INT mod 2 = 7 < DC 11
    const r = castSpell(h, 'magic-missile', { x: 1, y: 0 }, [m], scripted([5]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(true);
    expect(h.lostSpells).toEqual(['magic-missile']);
    expect(m.hp).toBe(hp0);
  });

  it('natural 1 loses the spell', () => {
    const h = wizard();
    const r = castSpell(h, 'light', { x: 0, y: 0 }, [], scripted([1]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(true);
    expect(h.lostSpells).toEqual(['light']);
  });

  it('a lost spell cannot be recast', () => {
    const h = wizard();
    castSpell(h, 'light', { x: 0, y: 0 }, [], scripted([1]));
    const r = castSpell(h, 'light', { x: 0, y: 0 }, [], scripted([]));
    expect(r.success).toBe(false);
    expect(r.lost).toBe(false);
  });

  it('uses WIS for priest spells', () => {
    const h = priest();
    h.hp = 1;
    // roll 10 + WIS mod 1 = 11 meets DC 11
    const r = castSpell(h, 'cure-wounds', { x: 0, y: 0 }, [], scripted([10, 3]));
    expect(r.success).toBe(true);
  });
});

describe('castSpell: effects', () => {
  it('magic missile auto-hits for 1d4 + floor(level/2)', () => {
    const h = wizard(4);
    const m = createMonster('rat', { x: 1, y: 0 }, createRng(1), 'r1');
    m.hp = 10;
    // check 15 + 2 = 17; damage 1d4 = 3 + floor(4/2) = 5
    const r = castSpell(h, 'magic-missile', { x: 1, y: 0 }, [m], scripted([15, 3]));
    expect(r.success).toBe(true);
    expect(r.lost).toBe(false);
    expect(m.hp).toBe(5);
  });

  it('sleep affects adjacent low-level minions only', () => {
    const h = wizard(10); // limit = 2 + 5 = 7
    const target = { x: 4, y: 0 };
    const goblin = createMonster('goblin', { x: 4, y: 0 }, createRng(1), 'g1');
    const boss = createMonster('crowned-lich', { x: 5, y: 0 }, createRng(1), 'b1');
    const cube = createMonster('gelatinous-cube', { x: 4, y: 2 }, createRng(1), 'c1');
    const r = castSpell(h, 'sleep', target, [goblin, boss, cube], scripted([20]));
    expect(r.success).toBe(true);
    expect(goblin.sleeping).toBe(true);
    expect(boss.isBoss).toBe(true);
    expect(boss.sleeping).toBe(false); // bosses are immune
    expect(cube.sleeping).toBe(false); // not within 1 square of target
  });

  it('sleep respects the level cap', () => {
    const h = wizard(2); // limit = 2 + 1 = 3
    const target = { x: 2, y: 0 };
    const cube = createMonster('gelatinous-cube', { x: 2, y: 0 }, createRng(1), 'c1'); // level 3 is allowed
    const shade = createMonster('shade', { x: 2, y: 1 }, createRng(1), 's1'); // level 3 is allowed
    const wolf = createMonster('wolf', { x: 1, y: 0 }, createRng(1), 'w1'); // level 2 is allowed
    castSpell(h, 'sleep', target, [cube, shade, wolf], scripted([20]));
    expect(cube.sleeping).toBe(true);
    expect(shade.sleeping).toBe(true);
    expect(wolf.sleeping).toBe(true);

    const h2 = wizard(1); // limit = 2
    const giant = createMonster('giant-snake', { x: 2, y: 0 }, createRng(1), 'gs'); // level 3
    castSpell(h2, 'sleep', { x: 2, y: 0 }, [giant], scripted([20]));
    expect(giant.sleeping).toBe(false);
  });

  it('cure wounds heals 1d6 + WIS mod', () => {
    const h = priest();
    h.maxHp = 10;
    h.hp = 2;
    // check 15 + 1; heal 4 + 1 = 5
    castSpell(h, 'cure-wounds', { x: 0, y: 0 }, [], scripted([15, 4]));
    expect(h.hp).toBe(7);
  });

  it('cure wounds is capped at maxHp', () => {
    const h = priest();
    h.maxHp = 10;
    h.hp = 9;
    castSpell(h, 'cure-wounds', { x: 0, y: 0 }, [], scripted([15, 6]));
    expect(h.hp).toBe(10);
  });

  it('turn undead damages undead in range, bosses take half', () => {
    const h = priest();
    const skeleton = createMonster('skeleton', { x: 3, y: 0 }, createRng(1), 's1');
    const wraith = createMonster('chalice-wraith', { x: 0, y: 2 }, createRng(1), 'w1');
    const rat = createMonster('rat', { x: 1, y: 1 }, createRng(1), 'r1');
    const farShade = createMonster('shade', { x: 7, y: 0 }, createRng(1), 'sh1');
    for (const m of [skeleton, wraith, rat, farShade]) m.hp = 50;

    // check 15 + 1; skeleton 2d6 = 7; wraith 2d6 = 11 -> half = 5
    castSpell(h, 'turn-undead', { x: 0, y: 0 }, [skeleton, wraith, rat, farShade], scripted([15, 3, 4, 5, 6]));
    expect(skeleton.hp).toBe(43);
    expect(wraith.hp).toBe(45);
    expect(rat.hp).toBe(50);
    expect(farShade.hp).toBe(50);
  });

  it('light sets torchTurns to 30', () => {
    const h = wizard();
    const r = castSpell(h, 'light', { x: 0, y: 0 }, [], scripted([15]));
    expect(r.success).toBe(true);
    expect(r.torchTurns).toBe(30);
  });
});
