import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVE_KEY,
  buyTorch,
  clearSave,
  endDelve,
  getCampaign,
  hasCampaign,
  loadCampaign,
  newCampaign,
  resetCampaign,
  saveCampaign,
  setCampaign,
  TORCH_PRICE,
} from './campaign';
import { createRng } from '../core/rng';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  const fake = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  return fake as unknown as Storage;
}

beforeEach(() => resetCampaign());

describe('save / load', () => {
  it('round-trips the campaign through storage', () => {
    const storage = memoryStorage();
    const c = newCampaign('Aldric', 'fighter', 42);
    c.hero.gold = 17;
    setCampaign(c);
    saveCampaign(storage);
    resetCampaign();

    const loaded = loadCampaign(storage);
    expect(loaded).toEqual(c);
    expect(hasCampaign()).toBe(true);
    expect(getCampaign()).toEqual(c);
  });

  it('returns null for missing data', () => {
    expect(loadCampaign(memoryStorage())).toBeNull();
  });

  it('returns null for corrupt JSON without throwing', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(() => loadCampaign(storage)).not.toThrow();
    expect(loadCampaign(storage)).toBeNull();
    expect(hasCampaign()).toBe(false);
  });

  it('returns null for a wrong save version or malformed hero', () => {
    const storage = memoryStorage();
    const c = newCampaign('Aldric', 'fighter', 1);
    storage.setItem(SAVE_KEY, JSON.stringify({ ...c, version: 2 }));
    expect(loadCampaign(storage)).toBeNull();
    storage.setItem(SAVE_KEY, JSON.stringify({ ...c, hero: { name: 'x' } }));
    expect(loadCampaign(storage)).toBeNull();
  });

  it('clearSave removes the save', () => {
    const storage = memoryStorage();
    setCampaign(newCampaign('Aldric', 'fighter', 1));
    saveCampaign(storage);
    clearSave(storage);
    expect(loadCampaign(storage)).toBeNull();
  });

  it('saveCampaign does nothing when no campaign is set', () => {
    const storage = memoryStorage();
    saveCampaign(storage);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });
});

describe('newCampaign', () => {
  it('creates a level 1 hero with no delves and no discoveries', () => {
    const c = newCampaign('Brenna', 'wizard', 7);
    expect(c.version).toBe(1);
    expect(c.hero.name).toBe('Brenna');
    expect(c.hero.classId).toBe('wizard');
    expect(c.hero.level).toBe(1);
    expect(c.delves).toBe(0);
    expect(c.discovered).toEqual([]);
    expect(Number.isInteger(c.nextSkySeed)).toBe(true);
  });
});

describe('endDelve', () => {
  it('escaped banks carried gold and grants XP', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.carriedGold = 50;
    const report = endDelve(c, 'escaped', 'serpent', createRng(3));

    expect(c.hero.gold).toBe(50);
    expect(c.hero.carriedGold).toBe(0);
    expect(c.hero.xp).toBe(5);
    expect(c.delves).toBe(1);
    expect(report.some((l) => l.includes('50 gold'))).toBe(true);
  });

  it('escaped with enough gold levels up', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.carriedGold = 120;
    endDelve(c, 'escaped', 'serpent', createRng(3));
    expect(c.hero.level).toBe(2);
    expect(c.hero.xp).toBe(2);
  });

  it('died loses carried gold and adds an injury that reduces maxHp', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.carriedGold = 80;
    c.hero.gold = 10;
    const maxBefore = c.hero.maxHp;
    const report = endDelve(c, 'died', 'crown', createRng(9));

    expect(c.hero.carriedGold).toBe(0);
    expect(c.hero.gold).toBe(10);
    expect(report).toContain('Your hoard is lost to the dark.');
    expect(c.hero.injuries).toHaveLength(1);
    expect(c.hero.maxHp).toBe(maxBefore - 1);
    expect(c.hero.hp).toBe(c.hero.maxHp);
    expect(c.delves).toBe(1);
    expect(c.discovered).toEqual([]);
  });

  it('maxHp never drops below 1 from injuries', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.maxHp = 1;
    endDelve(c, 'died', 'crown', createRng(9));
    expect(c.hero.maxHp).toBe(1);
  });

  it('discovered has no duplicates and skips unnamed', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    const rng = createRng(5);
    endDelve(c, 'escaped', 'serpent', rng);
    endDelve(c, 'escaped', 'serpent', rng);
    endDelve(c, 'escaped', 'unnamed', rng);
    endDelve(c, 'escaped', 'hound', rng);
    expect(c.discovered).toEqual(['serpent', 'hound']);
  });

  it('a death does not record a discovery', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    endDelve(c, 'died', 'archer', createRng(5));
    expect(c.discovered).toEqual([]);
  });

  it('refills torches to at least 1 with a pity torch', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.torches = 0;
    const report = endDelve(c, 'escaped', 'serpent', createRng(1));
    expect(c.hero.torches).toBe(1);
    expect(report).toContain('A stranger leaves you a torch.');
  });

  it('resets position and rolls a new sky seed', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.pos = { x: 4, y: 9 };
    const before = c.nextSkySeed;
    endDelve(c, 'escaped', 'serpent', createRng(1));
    expect(c.hero.pos).toEqual({ x: 0, y: 0 });
    expect(c.nextSkySeed).not.toBe(before);
  });
});

describe('buyTorch', () => {
  it('deducts gold and adds a torch', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.gold = TORCH_PRICE;
    const torches = c.hero.torches;
    expect(buyTorch(c)).toBe(true);
    expect(c.hero.gold).toBe(0);
    expect(c.hero.torches).toBe(torches + 1);
  });

  it('refuses when gold is too low and changes nothing', () => {
    const c = newCampaign('Aldric', 'fighter', 1);
    c.hero.gold = TORCH_PRICE - 1;
    const torches = c.hero.torches;
    expect(buyTorch(c)).toBe(false);
    expect(c.hero.gold).toBe(TORCH_PRICE - 1);
    expect(c.hero.torches).toBe(torches);
  });
});
