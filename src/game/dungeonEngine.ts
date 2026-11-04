// Pure dungeon-delve logic: exploration, FOV, combat turns, torches. No Phaser imports.
import { isWalkable, tileAt } from '../core/dungeon';
import { createMonster } from '../core/monsters';
import { createRng } from '../core/rng';
import { applyDamage, distance, grantXp, resolveAttack, rollInitiative } from '../core/rules';
import { castSpell } from '../core/spells';
import { THEME_MONSTERS, Tile, TORCH_TURNS } from '../core/types';
import type {
  AttackDef,
  Creature,
  DungeonMap,
  Hero,
  Monster,
  Point,
  Rng,
  SpellId,
  TreasureSpawn,
} from '../core/types';

export const FOV_LIT = 6;
export const FOV_DARK = 1;
/** How far a monster can see the hero (used to decide whether combat continues). */
export const MONSTER_SIGHT = 6;
export const EXPLORE_STEPS_PER_ROUND = 6;
export const DARK_SPAWN_EVERY = 10;
export const DARK_SPAWN_CHANCE = 1 / 3;
const LOG_LIMIT = 50;
const HERO_ID = 'hero';
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export type EngineEvent =
  | { kind: 'move'; id: string; from: Point; to: Point }
  | { kind: 'attack'; attackerId: string; targetId: string; hit: boolean; crit: boolean; damage: number }
  | { kind: 'death'; id: string; name: string; boss: boolean }
  | { kind: 'log'; text: string };

export type EngineMode = 'explore' | 'combat';
export type EngineOutcome = 'escaped' | 'died' | null;

interface InitEntry { id: string; init: number }

const idx = (map: DungeonMap, p: Point): number => p.y * map.width + p.x;
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const inBounds = (map: DungeonMap, p: Point): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;

/** Bresenham line. Every tile strictly between a and b must not be wall or void. */
function lineClear(map: DungeonMap, a: Point, b: Point): boolean {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const sx = a.x < b.x ? 1 : -1;
  const dy = -Math.abs(b.y - a.y);
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === b.x && y === b.y) return true;
    if (!(x === a.x && y === a.y)) {
      const t = tileAt(map, x, y);
      if (t === Tile.Wall || t === Tile.Void) return false;
    }
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** Diagonal steps may not cut past a wall corner: both orthogonal neighbours must be walkable. */
function cornerOk(map: DungeonMap, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 || dy === 0) return true;
  return isWalkable(tileAt(map, a.x + dx, a.y)) && isWalkable(tileAt(map, a.x, a.y + dy));
}

function canStep(map: DungeonMap, a: Point, b: Point): boolean {
  return isWalkable(tileAt(map, b.x, b.y)) && cornerOk(map, a, b);
}

function canAttackFrom(map: DungeonMap, a: Point, b: Point): boolean {
  return distance(a, b) === 1 && cornerOk(map, a, b);
}

export class DungeonEngine {
  readonly map: DungeonMap;
  readonly hero: Hero;
  /** Every monster on the level, living or dead (check hp). */
  readonly monsters: Monster[] = [];
  /** Tile indices (y * width + x) the hero can currently see. */
  readonly visible = new Set<number>();
  /** Tile indices the hero has ever seen. */
  readonly explored = new Set<number>();

  private readonly rng: Rng;
  private readonly byId = new Map<string, Monster>();
  private treasureLeft: TreasureSpawn[];
  /** Monsters that have noticed the hero. Cleared when combat ends. */
  private aware = new Set<string>();
  private slain = new Set<string>();
  private order: string[] = [];
  private initiative = new Map<string, number>();
  private turnIndex = -1;
  private modeValue: EngineMode = 'explore';
  private outcomeValue: EngineOutcome = null;
  private movementLeft = 0;
  private actionUsed = false;
  private round = 0;
  private exploreSteps = 0;
  private torchRounds = 0;
  private darkRounds = 0;
  private wanderCount = 0;
  private logLines: string[] = [];
  private events: EngineEvent[] = [];

  constructor(map: DungeonMap, hero: Hero, seed: number) {
    this.map = map;
    this.hero = hero;
    this.rng = createRng(seed);
    this.treasureLeft = map.treasure.map((t) => ({ ...t, pos: { ...t.pos } }));
    hero.pos = { ...map.start };
    hero.carriedGold = 0;

    map.monsters.forEach((spawn, i) => {
      const m = createMonster(spawn.monsterId, spawn.pos, this.rng, `m${i}`);
      this.monsters.push(m);
      this.byId.set(m.id, m);
    });

    if (hero.torches > 0) {
      hero.torches -= 1;
      this.torchRounds = TORCH_TURNS;
      this.say(`You light a torch. ${hero.torches} left in your pack.`);
    } else {
      this.say('No torches left. You enter in darkness.');
    }
    this.say('You descend into the dark.');
    this.updateFov();
    this.reconcile();
    this.events = [];
  }

  // ---------- Getters ----------

  get mode(): EngineMode { return this.modeValue; }
  get outcome(): EngineOutcome { return this.outcomeValue; }
  get log(): readonly string[] { return this.logLines; }
  /** Combat round counter (1-based; stale outside combat). */
  get roundNumber(): number { return this.round; }
  /** Torch rounds left on the lit torch (0 = dark). */
  get torchRoundsLeft(): number { return this.torchRounds; }
  get torchesInPack(): number { return this.hero.torches; }
  get isDark(): boolean { return this.torchRounds <= 0; }
  get litRadius(): number { return this.isDark ? FOV_DARK : FOV_LIT; }
  /** Squares of movement left this turn (combat). */
  get remainingMovement(): number { return this.movementLeft; }
  /** Exploration steps taken in the current torch round (0..5). */
  get exploreStepCount(): number { return this.exploreSteps; }
  /** False once the hero has spent the combat action this turn. Always true in explore. */
  get actionAvailable(): boolean { return this.modeValue !== 'combat' || !this.actionUsed; }
  get currentActor(): Creature | null {
    if (this.modeValue !== 'combat') return null;
    const id = this.order[this.turnIndex];
    if (id === undefined) return null;
    return id === HERO_ID ? this.hero : this.byId.get(id) ?? null;
  }
  get initiativeOrder(): Array<{ creature: Creature; initiative: number; current: boolean }> {
    if (this.modeValue !== 'combat') return [];
    return this.order.map((id, i) => {
      const creature: Creature = id === HERO_ID ? this.hero : this.byId.get(id)!;
      return { creature, initiative: this.initiative.get(id) ?? 0, current: i === this.turnIndex };
    });
  }
  get livingMonsters(): Monster[] { return this.monsters.filter((m) => m.hp > 0); }
  get remainingTreasure(): readonly TreasureSpawn[] { return this.treasureLeft; }

  isVisible(p: Point): boolean { return inBounds(this.map, p) && this.visible.has(idx(this.map, p)); }
  isExplored(p: Point): boolean { return inBounds(this.map, p) && this.explored.has(idx(this.map, p)); }

  /** Spells that need a target tile (the rest cast on the hero or the surroundings). */
  needsTarget(spell: SpellId): boolean {
    return spell === 'magic-missile' || spell === 'sleep';
  }

  /** Living, visible monsters within the hero's ranged attack, nearest first. Empty if no ranged attack. */
  rangedTargets(): Monster[] {
    const atk = this.rangedAttackDef();
    if (!atk) return [];
    return this.livingMonsters
      .filter((m) => this.isVisible(m.pos)
        && distance(this.hero.pos, m.pos) <= atk.range
        && lineClear(this.map, this.hero.pos, m.pos))
      .sort((a, b) => distance(this.hero.pos, a.pos) - distance(this.hero.pos, b.pos));
  }

  // ---------- Actions (public API). Each returns the events it produced. ----------

  tryMove(dx: number, dy: number): EngineEvent[] {
    return this.run(() => this.doMove(dx, dy));
  }

  /** Melee attack the monster at pos (must be adjacent). */
  attackAt(pos: Point): EngineEvent[] {
    return this.run(() => {
      const m = this.livingMonsterAt(pos);
      if (!m) { this.say('Nothing to attack there.'); return; }
      if (!canAttackFrom(this.map, this.hero.pos, pos)) { this.say('Out of reach.'); return; }
      if (this.doAttack(m, this.meleeAttack())) this.afterHeroAction(true);
    });
  }

  /** Ranged attack with the hero's first range > 1 weapon. */
  rangedAttack(monsterId: string): EngineEvent[] {
    return this.run(() => {
      const atk = this.rangedAttackDef();
      if (!atk) { this.say(`${this.hero.name} has no ranged attack.`); return; }
      const m = this.byId.get(monsterId);
      if (!m || m.hp <= 0 || !this.isVisible(m.pos)
        || distance(this.hero.pos, m.pos) > atk.range || !lineClear(this.map, this.hero.pos, m.pos)) {
        this.say('No target in range.');
        return;
      }
      if (this.doAttack(m, atk)) this.afterHeroAction(true);
    });
  }

  /** Casts a spell. Self spells ignore target. Magic missile and sleep need a target tile. */
  cast(spell: SpellId, target?: Point): EngineEvent[] {
    return this.run(() => {
      const { hero } = this;
      if (this.modeValue === 'combat' && this.actionUsed) {
        this.say('You have already acted this turn.');
        return;
      }
      const at = target ?? hero.pos;
      if (spell === 'magic-missile' && !this.targetMonsterAt(at)) {
        this.say('No visible monster there.');
        return;
      }
      if (spell === 'sleep' && !this.isVisible(at)) {
        this.say('You can only target what you can see.');
        return;
      }

      const before = new Map(this.monsters.map((m) => [m.id, m.hp]));
      const res = castSpell(hero, spell, at, this.monsters, this.rng);
      for (const line of res.log) this.say(line);
      if (res.torchTurns) {
        const wasDark = this.isDark;
        this.torchRounds += res.torchTurns;
        if (wasDark) this.say('Your light pushes back the dark.');
      }
      for (const m of this.monsters) {
        const lost = (before.get(m.id) ?? m.hp) - m.hp;
        if (lost > 0) {
          this.events.push({ kind: 'attack', attackerId: HERO_ID, targetId: m.id, hit: true, crit: false, damage: lost });
        }
      }
      this.settleDeaths();

      if (res.success || res.lost) {
        if (this.modeValue === 'combat') this.actionUsed = true;
        this.afterHeroAction(true);
      }
    });
  }

  /** Combat only: spend the action for +speed movement. */
  dash(): EngineEvent[] {
    return this.run(() => {
      if (this.modeValue !== 'combat') { this.say('Nothing to dash from.'); return; }
      if (this.actionUsed) { this.say('You have already acted this turn.'); return; }
      this.actionUsed = true;
      this.movementLeft += this.hero.speed;
      this.say(`${this.hero.name} dashes.`);
      this.afterHeroAction(false);
    });
  }

  /** Combat: ends the hero's turn and runs monster turns. Explore: waits one step. */
  endTurn(): EngineEvent[] {
    return this.run(() => {
      if (this.modeValue === 'combat') this.endHeroTurn();
      else this.exploreStep();
    });
  }

  // ---------- Internals ----------

  private run(fn: () => void): EngineEvent[] {
    if (this.outcomeValue) return [];
    fn();
    this.updateFov();
    this.reconcile();
    return this.take();
  }

  private take(): EngineEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private say(text: string): void {
    this.logLines.push(text);
    if (this.logLines.length > LOG_LIMIT) this.logLines.splice(0, this.logLines.length - LOG_LIMIT);
    this.events.push({ kind: 'log', text });
  }

  private die(): void {
    if (this.outcomeValue) return;
    this.outcomeValue = 'died';
    this.say(`${this.hero.name} falls. Darkness takes you...`);
  }

  private rangedAttackDef(): AttackDef | undefined {
    return this.hero.attacks.find((a) => a.range > 1);
  }

  private meleeAttack(): AttackDef {
    return this.hero.attacks.find((a) => a.range <= 1) ?? this.hero.attacks[0];
  }

  private livingMonsterAt(p: Point, exceptId?: string): Monster | undefined {
    return this.monsters.find((m) => m.hp > 0 && m.id !== exceptId && samePoint(m.pos, p));
  }

  private targetMonsterAt(p: Point): Monster | undefined {
    const m = this.livingMonsterAt(p);
    return m && this.isVisible(m.pos) ? m : undefined;
  }

  private nameOf(id: string): string {
    return id === HERO_ID ? this.hero.name : this.byId.get(id)?.name ?? id;
  }

  private updateFov(): void {
    const { map, hero } = this;
    const r = this.litRadius;
    this.visible.clear();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r) continue;
        const p = { x: hero.pos.x + dx, y: hero.pos.y + dy };
        if (!inBounds(map, p) || !lineClear(map, hero.pos, p)) continue;
        const i = idx(map, p);
        this.visible.add(i);
        this.explored.add(i);
      }
    }
  }

  /** Marks monsters that the hero can now see as aware. Starts combat, or appends joiners in combat. */
  private reconcile(): void {
    if (this.outcomeValue) return;
    const newly: string[] = [];
    for (const m of this.monsters) {
      if (m.hp <= 0 || m.sleeping || this.aware.has(m.id)) continue;
      if (!this.visible.has(idx(this.map, m.pos))) continue;
      this.aware.add(m.id);
      newly.push(m.id);
      this.say(`${m.name} spots you!`);
    }
    if (this.modeValue === 'explore') {
      if (this.aware.size > 0) this.startCombat();
    } else if (newly.length > 0) {
      this.order.push(...newly);
    }
  }

  private startCombat(): void {
    this.modeValue = 'combat';
    const entries: InitEntry[] = [{ id: HERO_ID, init: rollInitiative(this.hero, this.rng) }];
    for (const m of this.monsters) {
      if (m.hp > 0 && this.aware.has(m.id)) entries.push({ id: m.id, init: rollInitiative(m, this.rng) });
    }
    // Highest first; hero wins ties; otherwise keep monster array order (sort is stable).
    entries.sort((a, b) => b.init - a.init
      || (a.id === HERO_ID ? -1 : b.id === HERO_ID ? 1 : 0));
    this.order = entries.map((e) => e.id);
    this.initiative = new Map(entries.map((e) => [e.id, e.init]));
    this.round = 1;
    this.say(`Combat! Initiative: ${entries.map((e) => `${this.nameOf(e.id)} ${e.init}`).join(', ')}.`);
    this.turnIndex = -1;
    this.advance();
    if (!this.outcomeValue) this.beginHeroTurn();
  }

  private beginHeroTurn(): void {
    this.movementLeft = this.hero.speed;
    this.actionUsed = false;
  }

  /** Runs monster turns until the hero's turn comes round again (or the hero dies). */
  private advance(): void {
    while (!this.outcomeValue) {
      this.turnIndex += 1;
      if (this.turnIndex >= this.order.length) {
        this.turnIndex = 0;
        this.round += 1;
        this.tickRound();
      }
      const id = this.order[this.turnIndex];
      if (id === HERO_ID) return;
      const m = this.byId.get(id);
      if (m && m.hp > 0 && !m.sleeping && this.aware.has(id)) this.monsterTurn(m);
    }
  }

  private endHeroTurn(): void {
    this.movementLeft = 0;
    this.actionUsed = true;
    this.advance();
    if (this.outcomeValue) return;
    if (!this.checkCombatEnd()) this.beginHeroTurn();
  }

  /** Combat ends when no living aware monster can see the hero. */
  private checkCombatEnd(): boolean {
    if (this.modeValue !== 'combat') return false;
    const threat = this.livingMonsters.some((m) => this.aware.has(m.id) && this.canSeeHero(m));
    if (threat) return false;
    this.modeValue = 'explore';
    this.aware.clear();
    this.order = [];
    this.initiative.clear();
    this.turnIndex = -1;
    this.movementLeft = 0;
    this.actionUsed = false;
    this.say('The fight is over. Silence settles back over the dungeon.');
    return true;
  }

  private canSeeHero(m: Monster): boolean {
    return distance(m.pos, this.hero.pos) <= MONSTER_SIGHT && lineClear(this.map, m.pos, this.hero.pos);
  }

  /** Common tail for hero actions: refresh FOV and awareness, then auto-end the turn if spent. */
  private afterHeroAction(mayEnd: boolean): void {
    this.updateFov();
    this.reconcile();
    if (this.modeValue !== 'combat' || this.outcomeValue) return;
    if (mayEnd && this.checkCombatEnd()) return;
    if (this.movementLeft <= 0 && this.actionUsed) this.endHeroTurn();
  }

  private exploreStep(): void {
    this.exploreSteps += 1;
    if (this.exploreSteps >= EXPLORE_STEPS_PER_ROUND) {
      this.exploreSteps = 0;
      this.tickRound();
    }
  }

  /** One torch round (explore: every 6 steps; combat: every full round). */
  private tickRound(): void {
    if (this.torchRounds > 0) {
      this.torchRounds -= 1;
      if (this.torchRounds === 10) this.say('Your torch is burning low.');
      if (this.torchRounds === 0) {
        if (this.hero.torches > 0) {
          this.hero.torches -= 1;
          this.torchRounds = TORCH_TURNS;
          this.say(`Your torch gutters out. You light a fresh one (${this.hero.torches} left).`);
        } else {
          this.say('Your last torch gutters out. Darkness closes in.');
        }
      }
      return;
    }
    this.darkRounds += 1;
    if (this.darkRounds % DARK_SPAWN_EVERY === 0 && this.rng.next() < DARK_SPAWN_CHANCE) {
      this.spawnWanderer();
    }
  }

  private spawnWanderer(): void {
    const { map } = this;
    const candidates: Point[] = [];
    for (const i of this.explored) {
      if (this.visible.has(i)) continue;
      const t = map.tiles[i];
      if (t !== Tile.Floor && t !== Tile.Door) continue;
      const p = { x: i % map.width, y: Math.floor(i / map.width) };
      if (this.livingMonsterAt(p) || samePoint(p, this.hero.pos)) continue;
      if (this.treasureLeft.some((tr) => samePoint(tr.pos, p))) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) return;
    const pos = this.rng.pick(candidates);
    const id = this.rng.pick(THEME_MONSTERS[map.theme].minions);
    const m = createMonster(id, pos, this.rng, `w${this.wanderCount++}`);
    this.monsters.push(m);
    this.byId.set(m.id, m);
    this.aware.add(m.id);
    if (this.modeValue === 'combat') this.order.push(m.id);
    this.say('Something stirs in the dark...');
  }

  /** Returns true if the hero's action happened (not refused). */
  private doAttack(m: Monster, atk: AttackDef): boolean {
    if (this.modeValue === 'combat') {
      if (this.actionUsed) { this.say('You have already acted this turn.'); return false; }
      this.actionUsed = true;
    } else {
      this.say('You strike first, from the shadows!');
    }
    const mode: 'normal' | 'disadvantage' = this.isDark ? 'disadvantage' : 'normal';
    const res = resolveAttack(this.hero, m, atk, this.rng, mode);
    this.say(res.log);
    this.events.push({
      kind: 'attack', attackerId: HERO_ID, targetId: m.id, hit: res.hit, crit: res.crit, damage: res.damage,
    });
    if (res.hit) applyDamage(m, res.damage);
    this.settleDeaths();
    return true;
  }

  private monsterAttack(m: Monster, atk: AttackDef): void {
    const res = resolveAttack(m, this.hero, atk, this.rng);
    this.say(res.log);
    this.events.push({
      kind: 'attack', attackerId: m.id, targetId: HERO_ID, hit: res.hit, crit: res.crit, damage: res.damage,
    });
    if (res.hit) {
      applyDamage(this.hero, res.damage);
      if (this.hero.hp <= 0) this.die();
    }
  }

  /** Grants XP and logs deaths once per monster. */
  private settleDeaths(): void {
    for (const m of this.monsters) {
      if (m.hp > 0 || this.slain.has(m.id)) continue;
      this.slain.add(m.id);
      this.aware.delete(m.id);
      this.events.push({ kind: 'death', id: m.id, name: m.name, boss: m.isBoss });
      this.say(m.isBoss
        ? `The ${m.name} collapses with a shriek. The whole dungeon trembles!`
        : `${m.name} is slain.`);
      for (const line of grantXp(this.hero, m.xpValue, this.rng)) this.say(line);
    }
  }

  private doMove(dx: number, dy: number): void {
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    const { map, hero } = this;
    const to = { x: hero.pos.x + dx, y: hero.pos.y + dy };

    if (!inBounds(map, to) || !isWalkable(tileAt(map, to.x, to.y))) {
      this.say('A wall blocks the way.');
      return;
    }
    if (!cornerOk(map, hero.pos, to)) {
      this.say('A wall corner blocks the diagonal.');
      return;
    }

    const m = this.livingMonsterAt(to);
    if (m) {
      if (this.doAttack(m, this.meleeAttack())) this.afterHeroAction(true);
      return;
    }

    if (this.modeValue === 'combat') {
      if (this.movementLeft <= 0) { this.say('No movement left this turn.'); return; }
      this.movementLeft -= 1;
    }

    const from = hero.pos;
    hero.pos = { x: to.x, y: to.y };
    this.events.push({ kind: 'move', id: HERO_ID, from, to: { ...hero.pos } });
    this.updateFov();

    const ti = this.treasureLeft.findIndex((t) => samePoint(t.pos, hero.pos));
    if (ti >= 0) {
      const gold = this.treasureLeft[ti].gold;
      this.treasureLeft.splice(ti, 1);
      hero.carriedGold += gold;
      this.say(`You pick up ${gold} gold.`);
    }

    if (samePoint(hero.pos, map.exit)) {
      this.outcomeValue = 'escaped';
      this.say('You climb back toward the stars. The dungeon lets you go.');
      return;
    }

    if (this.modeValue === 'explore') this.exploreStep();
    this.afterHeroAction(false);
  }

  private monsterTurn(m: Monster): void {
    const { map, hero } = this;
    const melee = m.attacks.find((a) => a.range <= 1) ?? m.attacks[0];
    const ranged = m.behaviour === 'ranged' ? m.attacks.find((a) => a.range > 1) : undefined;
    const shoots = (from: Point): boolean =>
      ranged !== undefined && distance(from, hero.pos) <= ranged.range && lineClear(map, from, hero.pos);
    const reaches = (from: Point): boolean => canAttackFrom(map, from, hero.pos);

    if (ranged) {
      if (!reaches(m.pos) && !shoots(m.pos)) {
        // Keep 3+ squares away while finding a line of sight within range.
        const path = this.findPath(m, (p) => distance(p, hero.pos) >= 3 && shoots(p));
        if (path) this.walk(m, path, m.speed);
      }
    } else if (!reaches(m.pos)) {
      const path = this.findPath(m, reaches);
      if (path) this.walk(m, path, m.speed);
    }

    if (this.outcomeValue) return;
    if (reaches(m.pos)) this.monsterAttack(m, melee);
    else if (ranged && shoots(m.pos)) this.monsterAttack(m, ranged);
  }

  /** BFS over walkable tiles. Other monsters and the hero block. Returns steps (excluding start) or null. */
  private findPath(m: Monster, goal: (p: Point) => boolean): Point[] | null {
    const { map, hero } = this;
    const start = m.pos;
    if (goal(start)) return [];
    const startKey = idx(map, start);
    const parent = new Map<number, Point>();
    const seen = new Set<number>([startKey]);
    const queue: Point[] = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const [dx, dy] of DIRS) {
        const next = { x: cur.x + dx, y: cur.y + dy };
        if (!inBounds(map, next)) continue;
        const ni = idx(map, next);
        if (seen.has(ni) || !canStep(map, cur, next)) continue;
        if (samePoint(next, hero.pos) || this.livingMonsterAt(next, m.id)) continue;
        seen.add(ni);
        parent.set(ni, cur);
        if (goal(next)) {
          const path: Point[] = [];
          let p = next;
          while (idx(map, p) !== startKey) {
            path.push(p);
            p = parent.get(idx(map, p))!;
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }

  private walk(m: Monster, path: Point[], steps: number): void {
    for (const p of path.slice(0, steps)) {
      const from = m.pos;
      m.pos = { x: p.x, y: p.y };
      this.events.push({ kind: 'move', id: m.id, from, to: { x: p.x, y: p.y } });
    }
  }
}
