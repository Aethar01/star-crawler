import { describe, it, expect } from 'vitest';
import { BOSS_IDS, MINION_IDS } from './types';
import type { MonsterId } from './types';
import { createRng } from './rng';
import { parseDice } from './dice';
import { MONSTERS, createMonster } from './monsters';

const ALL_IDS: MonsterId[] = [...MINION_IDS, ...BOSS_IDS];

describe('MONSTERS', () => {
  it('defines every minion and boss id', () => {
    for (const id of ALL_IDS) {
      expect(MONSTERS[id], id).toBeDefined();
    }
    expect(Object.keys(MONSTERS).sort()).toEqual([...ALL_IDS].sort());
  });

  it('has valid hp expressions, attacks and stats', () => {
    for (const id of ALL_IDS) {
      const def = MONSTERS[id];
      expect(() => parseDice(def.hp), id).not.toThrow();
      expect(def.attacks.length, id).toBeGreaterThanOrEqual(1);
      expect(def.attacks.length, id).toBeLessThanOrEqual(2);
      expect(Object.keys(def.stats).sort(), id).toEqual(['CHA', 'CON', 'DEX', 'INT', 'STR', 'WIS']);
      expect(def.speed, id).toBeGreaterThan(0);
    }
  });

  it('minions are level 1-3 and not bosses', () => {
    for (const id of MINION_IDS) {
      expect(MONSTERS[id].level, id).toBeGreaterThanOrEqual(1);
      expect(MONSTERS[id].level, id).toBeLessThanOrEqual(3);
      expect(MONSTERS[id].isBoss, id).toBe(false);
    }
  });

  it('bosses are level 4-5, AC 13-15, with 1-2 attacks', () => {
    for (const id of BOSS_IDS) {
      const def = MONSTERS[id];
      expect(def.isBoss, id).toBe(true);
      expect(def.level, id).toBeGreaterThanOrEqual(4);
      expect(def.level, id).toBeLessThanOrEqual(5);
      expect(def.ac, id).toBeGreaterThanOrEqual(13);
      expect(def.ac, id).toBeLessThanOrEqual(15);
    }
  });

  it('only shadow-archer among bosses has ranged behaviour', () => {
    const ranged = BOSS_IDS.filter((id) => MONSTERS[id].behaviour === 'ranged');
    expect(ranged).toEqual(['shadow-archer']);
  });

  it('undead set is exactly skeleton, shade, crowned-lich, chalice-wraith', () => {
    const undead = ALL_IDS.filter((id) => MONSTERS[id].undead).sort();
    expect(undead).toEqual(['chalice-wraith', 'crowned-lich', 'shade', 'skeleton']);
  });

  it('shadow-archer, goblin and cultist have a ranged attack', () => {
    for (const id of ['shadow-archer', 'goblin', 'cultist'] as const) {
      expect(MONSTERS[id].attacks.some((a) => a.range > 1), id).toBe(true);
    }
  });
});

describe('createMonster', () => {
  it('rolls hp within the dice range (min 1)', () => {
    const rng = createRng(11);
    for (let i = 0; i < 100; i++) {
      const m = createMonster('rat', { x: 0, y: 0 }, rng, `r${i}`);
      expect(m.hp).toBeGreaterThanOrEqual(1);
      expect(m.hp).toBeLessThanOrEqual(4);
      expect(m.maxHp).toBe(m.hp);
    }
  });

  it('rolls larger hp for gelatinous-cube (4d8)', () => {
    const rng = createRng(12);
    for (let i = 0; i < 100; i++) {
      const m = createMonster('gelatinous-cube', { x: 0, y: 0 }, rng, `c${i}`);
      expect(m.hp).toBeGreaterThanOrEqual(4);
      expect(m.hp).toBeLessThanOrEqual(32);
    }
  });

  it('starts awake and copies id, position and definition fields', () => {
    const m = createMonster('shadow-archer', { x: 3, y: 4 }, createRng(1), 'sa-1');
    expect(m.id).toBe('sa-1');
    expect(m.monsterId).toBe('shadow-archer');
    expect(m.name).toBe(MONSTERS['shadow-archer'].name);
    expect(m.pos).toEqual({ x: 3, y: 4 });
    expect(m.sleeping).toBe(false);
    expect(m.isBoss).toBe(true);
    expect(m.behaviour).toBe('ranged');
  });

  it('does not share mutable state with the definition', () => {
    const m = createMonster('goblin', { x: 0, y: 0 }, createRng(1), 'g1');
    m.attacks[0].damage = '9d9';
    m.stats.STR = 99;
    expect(MONSTERS.goblin.attacks[0].damage).not.toBe('9d9');
    expect(MONSTERS.goblin.stats.STR).not.toBe(99);
  });

  it('is deterministic for the same seed', () => {
    const a = createMonster('hellhound', { x: 0, y: 0 }, createRng(77), 'h');
    const b = createMonster('hellhound', { x: 0, y: 0 }, createRng(77), 'h');
    expect(a.hp).toBe(b.hp);
  });
});
