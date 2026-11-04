import type { Ability, Hero, Monster, Point, Rng, SpellId } from './types';
import { rollD20, rollDice } from './dice';
import { abilityMod, applyDamage, distance } from './rules';

export interface SpellDef {
  name: string;
  range: number;
  description: string;
  ability: Ability;
}

export interface SpellResult {
  success: boolean;
  lost: boolean;
  log: string[];
  torchTurns?: number;
}

const SPELL_DC = 11;
const LIGHT_TURNS = 30;

export const SPELLS: Record<SpellId, SpellDef> = {
  'magic-missile': {
    name: 'Magic Missile',
    range: 6,
    description: 'Auto-hit 1d4 + half your level damage to one monster.',
    ability: 'INT',
  },
  sleep: {
    name: 'Sleep',
    range: 6,
    description: 'Monsters within 1 square of the target with level <= 2 + half your level fall asleep. Bosses are immune.',
    ability: 'INT',
  },
  'cure-wounds': {
    name: 'Cure Wounds',
    range: 0,
    description: 'Heal yourself for 1d6 + WIS mod.',
    ability: 'WIS',
  },
  'turn-undead': {
    name: 'Turn Undead',
    range: 6,
    description: 'Undead within 6 squares take 2d6 (bosses take half).',
    ability: 'WIS',
  },
  light: {
    name: 'Light',
    range: 0,
    description: `Light a torch for ${LIGHT_TURNS} turns.`,
    ability: 'INT',
  },
};

/**
 * Casts a spell. Mutates the hero (lostSpells on failure, hp on cure-wounds)
 * and the targeted monsters. Spellcasting check: d20 + ability mod vs DC 11; natural 1 always fails.
 */
export function castSpell(
  hero: Hero,
  spell: SpellId,
  target: Point,
  monsters: Monster[],
  rng: Rng,
): SpellResult {
  const def = SPELLS[spell];

  if (hero.lostSpells.includes(spell) || !hero.spells.includes(spell)) {
    return { success: false, lost: false, log: [`${hero.name} cannot cast ${def.name}.`] };
  }

  if ((spell === 'magic-missile' || spell === 'sleep') && distance(hero.pos, target) > def.range) {
    return { success: false, lost: false, log: [`${def.name} is out of range.`] };
  }

  const roll = rollD20(rng);
  const total = roll + abilityMod(hero.stats[def.ability]);
  if (roll === 1 || total < SPELL_DC) {
    hero.lostSpells.push(spell);
    return {
      success: false,
      lost: true,
      log: [`${hero.name} fails to cast ${def.name} (${total} vs DC ${SPELL_DC}) and loses it until a long rest.`],
    };
  }

  const log: string[] = [`${hero.name} casts ${def.name}.`];
  let torchTurns: number | undefined;

  switch (spell) {
    case 'magic-missile': {
      const m = monsters.find((mo) => mo.hp > 0 && mo.pos.x === target.x && mo.pos.y === target.y);
      if (!m) {
        log.push('The missile hits nothing.');
        break;
      }
      const dmg = rollDice('1d4', rng) + Math.floor(hero.level / 2);
      const killed = applyDamage(m, dmg);
      log.push(`${m.name} takes ${dmg} damage.`);
      if (killed) log.push(`${m.name} is destroyed.`);
      break;
    }

    case 'sleep': {
      const limit = 2 + Math.floor(hero.level / 2);
      const affected = monsters.filter(
        (m) => m.hp > 0 && !m.isBoss && m.level <= limit && distance(m.pos, target) <= 1,
      );
      for (const m of affected) m.sleeping = true;
      log.push(affected.length > 0 ? `${affected.length} monster(s) fall asleep.` : 'No monsters fall asleep.');
      break;
    }

    case 'cure-wounds': {
      const heal = Math.max(1, rollDice('1d6', rng) + abilityMod(hero.stats.WIS));
      const before = hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + heal);
      log.push(`${hero.name} heals ${hero.hp - before} HP.`);
      break;
    }

    case 'turn-undead': {
      const undead = monsters.filter(
        (m) => m.hp > 0 && m.undead && distance(hero.pos, m.pos) <= def.range,
      );
      if (undead.length === 0) log.push('No undead within range.');
      for (const m of undead) {
        let dmg = rollDice('2d6', rng);
        if (m.isBoss) dmg = Math.max(1, Math.floor(dmg / 2));
        const killed = applyDamage(m, dmg);
        log.push(`${m.name} takes ${dmg} damage from ${def.name}.`);
        if (killed) log.push(`${m.name} is destroyed.`);
      }
      break;
    }

    case 'light':
      torchTurns = LIGHT_TURNS;
      log.push(`A light burns for ${LIGHT_TURNS} turns.`);
      break;
  }

  return { success: true, lost: false, log, torchTurns };
}
