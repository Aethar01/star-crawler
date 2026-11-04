import { createHero, goldToXp, grantXp, longRest } from '../core/rules';
import { createRng } from '../core/rng';
import type { CampaignState, ClassId, Rng, ThemeId } from '../core/types';

export const SAVE_KEY = 'star-crawler-save-v1';
export const TORCH_PRICE = 5;

const INJURIES: readonly string[] = [
  'Cracked ribs that never quite knit.',
  'A scar that drags one eyelid shut.',
  'Two fingers frozen stiff, curled around nothing.',
  'A limp that worsens in the cold.',
  'A ringing in the ears, and a whisper beneath it.',
  'A hand that shakes when you draw steel.',
  'Lungs scarred by grave-dust.',
  'A face the mirror no longer quite recognises.',
];

export type DelveOutcome = 'escaped' | 'died';

let current: CampaignState | null = null;

export function newCampaign(name: string, classId: ClassId, seed: number): CampaignState {
  const hero = createHero(name, classId, createRng(seed));
  const skyRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  return {
    version: 1,
    hero,
    delves: 0,
    nextSkySeed: skyRng.int(1, 0x7fffffff),
    discovered: [],
  };
}

export function getCampaign(): CampaignState {
  if (!current) throw new Error('getCampaign: no campaign is set');
  return current;
}

export function setCampaign(s: CampaignState): void {
  current = s;
}

export function hasCampaign(): boolean {
  return current !== null;
}

/** Forgets the in-memory campaign. Does not touch storage (see clearSave). */
export function resetCampaign(): void {
  current = null;
}

export function saveCampaign(storage: Storage = globalThis.localStorage): void {
  if (!current) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(current));
  } catch {
    // Storage full, blocked or unavailable: the game keeps running without persistence.
  }
}

export function loadCampaign(storage: Storage = globalThis.localStorage): CampaignState | null {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isCampaignState(data)) return null;
    setCampaign(data);
    return data;
  } catch {
    return null;
  }
}

export function clearSave(storage: Storage = globalThis.localStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/** Applies the result of a delve. Returns report lines for the camp screen. */
export function endDelve(s: CampaignState, outcome: DelveOutcome, theme: ThemeId, rng: Rng): string[] {
  const hero = s.hero;
  const report: string[] = [];

  if (outcome === 'escaped') {
    const carried = hero.carriedGold;
    hero.gold += carried;
    hero.carriedGold = 0;
    report.push(`You escape with ${carried} gold.`);
    const xp = goldToXp(carried);
    if (xp > 0) report.push(...grantXp(hero, xp, rng));
    if (theme !== 'unnamed' && !s.discovered.includes(theme)) s.discovered.push(theme);
  } else {
    hero.carriedGold = 0;
    report.push('Your hoard is lost to the dark.');
    const injury = rng.pick(INJURIES);
    hero.injuries.push(injury);
    hero.maxHp = Math.max(1, hero.maxHp - 1);
    report.push(`Injury: ${injury} (-1 max HP)`);
  }

  s.delves += 1;
  longRest(hero);
  hero.pos = { x: 0, y: 0 };
  s.nextSkySeed = rng.int(1, 0x7fffffff);

  if (hero.torches < 1) {
    hero.torches = 1;
    report.push('A stranger leaves you a torch.');
  }

  return report;
}

export function buyTorch(s: CampaignState): boolean {
  if (s.hero.gold < TORCH_PRICE) return false;
  s.hero.gold -= TORCH_PRICE;
  s.hero.torches += 1;
  return true;
}

// ---------- Save validation ----------

function isCampaignState(x: unknown): x is CampaignState {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  if (c.version !== 1 || !isHero(c.hero)) return false;
  return (
    typeof c.delves === 'number' &&
    typeof c.nextSkySeed === 'number' &&
    Array.isArray(c.discovered)
  );
}

function isHero(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  const nums = ['hp', 'maxHp', 'ac', 'level', 'xp', 'gold', 'carriedGold', 'torches'] as const;
  if (!nums.every((k) => typeof h[k] === 'number')) return false;
  if (typeof h.name !== 'string' || typeof h.classId !== 'string') return false;
  if (typeof h.stats !== 'object' || h.stats === null) return false;
  if (!Array.isArray(h.attacks) || !Array.isArray(h.spells)) return false;
  if (!Array.isArray(h.lostSpells) || !Array.isArray(h.injuries)) return false;
  if (typeof h.pos !== 'object' || h.pos === null) return false;
  return true;
}
