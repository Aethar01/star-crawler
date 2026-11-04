import Phaser from 'phaser';
import type { DungeonSceneData, Monster, Point, SpellId } from '../core/types';
import { TORCH_TURNS } from '../core/types';
import { generateDungeon } from '../core/dungeon';
import { THEME_INFO } from '../core/constellations';
import { CLASS_INFO } from '../core/rules';
import { createRng, hashString } from '../core/rng';
import { SPELLS } from '../core/spells';
import { DungeonEngine } from '../game/dungeonEngine';
import type { EngineEvent } from '../game/dungeonEngine';
import { endDelve, getCampaign, saveCampaign } from '../game/campaign';
import { SCALE, TEXTURE, createPixelTextures, monsterTextureKey, tileTextureKey } from '../game/pixelArt';

const TILE = 8 * SCALE; // texture px per tile; the camera zoom makes it 32 screen px
const ZOOM = 2;
const MOVE_MS = 120;
const VIEW = { x: 0, y: 64, w: 700, h: 440 };
const LOG_ROWS = 5;

const MOVE_KEYS: Record<string, [number, number] | undefined> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  KeyQ: [-1, -1], KeyE: [1, -1], KeyZ: [-1, 1], KeyC: [1, 1],
};

type Targeting =
  | { kind: 'spell'; spell: SpellId; cursor: Point }
  | { kind: 'ranged'; targets: Monster[]; index: number };

const text = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle =>
  ({ fontFamily: 'monospace', fontSize: `${size}px`, color });

const meter = (cur: number, max: number, n = 10): string => {
  const filled = Math.max(0, Math.min(n, Math.round((cur / Math.max(1, max)) * n)));
  return '■'.repeat(filled) + '□'.repeat(n - filled);
};

const centre = (p: Point): Point => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

export class DungeonScene extends Phaser.Scene {
  private entry!: DungeonSceneData;
  private seed = 0;
  private engine!: DungeonEngine;
  private busy = false;
  private ended = false;
  private targeting: Targeting | null = null;
  private helpOpen = false;
  private titleOpen = false;
  private toastMsg = '';

  private worldC!: Phaser.GameObjects.Container;
  private hudC!: Phaser.GameObjects.Container;
  private overlayC!: Phaser.GameObjects.Container;
  private helpC!: Phaser.GameObjects.Container;
  private titleC?: Phaser.GameObjects.Container;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private tileSprites: Array<Phaser.GameObjects.Image | undefined> = [];
  private monsterSprites = new Map<string, Phaser.GameObjects.Image>();
  private heroSprite!: Phaser.GameObjects.Image;
  private treasureSprites: Array<{ pos: Point; img: Phaser.GameObjects.Image }> = [];
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private hud!: {
    top: Phaser.GameObjects.Text;
    stats: Phaser.GameObjects.Text;
    mode: Phaser.GameObjects.Text;
    panel: Phaser.GameObjects.Text;
    prompt: Phaser.GameObjects.Text;
    logs: Phaser.GameObjects.Text[];
  };

  constructor() {
    super({ key: 'Dungeon' });
  }

  init(data: DungeonSceneData): void {
    this.entry = data;
  }

  create(): void {
    const { sky, constellation, match } = this.entry;
    this.seed = (sky.seed ^ hashString(constellation.starIds.join(','))) >>> 0;
    const map = generateDungeon(sky, constellation, match.theme, this.seed);
    this.engine = new DungeonEngine(map, getCampaign().hero, this.seed);
    this.targeting = null;
    this.busy = false;
    this.ended = false;
    this.helpOpen = false;
    this.toastMsg = '';

    createPixelTextures(this);
    this.buildWorld();
    this.buildHud();
    this.buildHelp();

    // World camera (zoomed, follows hero) and an unzoomed UI camera for the HUD.
    const cam = this.cameras.main;
    cam.setViewport(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    cam.setZoom(ZOOM);
    cam.setBackgroundColor('#000000');
    cam.setBounds(0, 0, map.width * TILE, map.height * TILE);
    cam.roundPixels = true;
    cam.startFollow(this.heroSprite, true);
    this.uiCam = this.cameras.add(0, 0, 960, 640);
    cam.ignore([this.hudC, this.overlayC]);
    this.uiCam.ignore(this.worldC);

    this.input.keyboard?.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'TAB']);
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));

    this.refresh();
    this.updateHud();
    this.showTitle(match.theme);
  }

  // ---------- Building ----------

  private buildWorld(): void {
    const { map, monsters, hero } = this.engine;
    this.worldC = this.add.container(0, 0);

    this.tileSprites = new Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        const key = tileTextureKey(map.tiles[i]);
        if (!key) continue;
        const img = this.add.image(x * TILE, y * TILE, key).setOrigin(0, 0).setAlpha(0);
        this.worldC.add(img);
        this.tileSprites[i] = img;
      }
    }

    for (const t of this.engine.remainingTreasure) {
      const img = this.add.image(0, 0, TEXTURE.gold).setVisible(false);
      this.worldC.add(img);
      this.treasureSprites.push({ pos: { ...t.pos }, img });
    }

    for (const m of monsters) {
      const img = this.add.image(0, 0, monsterTextureKey(m.monsterId, m.isBoss)).setOrigin(0.5).setVisible(false);
      this.worldC.add(img);
      this.monsterSprites.set(m.id, img);
    }

    this.heroSprite = this.add.image(0, 0, TEXTURE.hero(hero.classId)).setOrigin(0.5);
    this.worldC.add(this.heroSprite);

    this.cursorGfx = this.add.graphics();
    this.worldC.add(this.cursorGfx);
  }

  private buildHud(): void {
    this.hudC = this.add.container(0, 0).setScrollFactor(0);
    const mk = (x: number, y: number, size: number, color?: string): Phaser.GameObjects.Text => {
      const t = this.add.text(x, y, '', text(size, color));
      this.hudC.add(t);
      return t;
    };
    this.hud = {
      top: mk(12, 8, 15),
      stats: mk(12, 30, 13),
      mode: mk(12, 46, 13),
      panel: mk(716, 72, 13),
      prompt: mk(12, 508, 13),
      logs: Array.from({ length: LOG_ROWS }, (_, i) => mk(12, 530 + i * 20, 13)),
    };

    const rules = this.add.graphics();
    rules.lineStyle(1, 0xffffff, 1);
    rules.lineBetween(0, VIEW.y - 2, 960, VIEW.y - 2);
    rules.lineBetween(0, VIEW.y + VIEW.h + 2, 960, VIEW.y + VIEW.h + 2);
    rules.lineBetween(VIEW.w + 8, VIEW.y, VIEW.w + 8, VIEW.y + VIEW.h);
    this.hudC.add(rules);

    this.overlayC = this.add.container(0, 0);
  }

  private buildHelp(): void {
    const { hero } = this.engine;
    const spells = hero.spells.map((s, i) => `${i + 1}  ${SPELLS[s].name}${this.spellNote(s)}`);
    const lines = [
      'CONTROLS',
      '',
      'Move ........ Arrows / WASD / Numpad',
      'Diagonal .... Q E Z C  or  Numpad 7 9 1 3',
      'Attack ...... walk into a monster',
      'F ........... Ranged attack. TAB cycles, ENTER or F fires',
      'R ........... Dash (+speed movement, combat)',
      'SPACE ....... End turn (explore: wait one step)',
      '? ........... Toggle this help',
      '',
      'SPELLS',
      ...(spells.length ? spells : ['(none)']),
      '  Pick a target with move keys, ENTER to cast, ESC to cancel.',
      '',
      'Press any key to close.',
    ];
    this.helpC = this.add.container(0, 0);
    this.helpC.add(this.add.rectangle(0, 0, 960, 640, 0x000000, 0.94).setOrigin(0, 0));
    this.helpC.add(this.add.text(60, 60, lines.join('\n'), text(16)).setLineSpacing(4));
    this.helpC.setVisible(false);
    this.overlayC.add(this.helpC);
  }

  private spellNote(s: SpellId): string {
    return this.engine.needsTarget(s) ? '  (target)' : '  (self / instant)';
  }

  // ---------- Input ----------

  private onKey(ev: KeyboardEvent): void {
    if (this.ended) return;
    if (this.titleOpen) { this.closeTitle(); return; }
    if (this.helpOpen) { this.toggleHelp(false); return; }
    if (ev.key === '?') { this.toggleHelp(true); return; }
    if (this.busy) return;

    if (this.targeting) { this.onTargetingKey(ev); return; }

    const move = MOVE_KEYS[ev.code];
    if (move) {
      this.act(() => this.engine.tryMove(move[0], move[1]));
      return;
    }
    if (ev.repeat) return;
    switch (ev.code) {
      case 'Space':
      case 'Numpad5':
        this.act(() => this.engine.endTurn());
        break;
      case 'KeyR':
        this.act(() => this.engine.dash());
        break;
      case 'KeyF':
        this.startRanged();
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
        this.startSpell(Number(ev.code.slice(5)) - 1);
        break;
      default:
        break;
    }
  }

  private onTargetingKey(ev: KeyboardEvent): void {
    const t = this.targeting;
    if (!t) return;
    if (ev.code === 'Escape') {
      this.targeting = null;
      this.refresh();
      return;
    }
    if (ev.code === 'Enter' || (t.kind === 'ranged' && ev.code === 'KeyF')) {
      this.confirmTargeting();
      return;
    }
    if (t.kind === 'ranged') {
      if (ev.code === 'Tab') {
        t.index = (t.index + 1) % t.targets.length;
        this.refresh();
      }
      return;
    }
    const move = MOVE_KEYS[ev.code];
    if (move) {
      const { map } = this.engine;
      t.cursor = {
        x: Math.max(0, Math.min(map.width - 1, t.cursor.x + move[0])),
        y: Math.max(0, Math.min(map.height - 1, t.cursor.y + move[1])),
      };
      this.refresh();
    }
  }

  private startSpell(slot: number): void {
    const { hero } = this.engine;
    const spell = hero.spells[slot];
    if (!spell) { this.toast('No spell in that slot.'); return; }
    if (hero.lostSpells.includes(spell)) { this.toast(`${SPELLS[spell].name} is lost until a long rest.`); return; }
    if (this.engine.needsTarget(spell)) {
      const near = this.engine.livingMonsters
        .filter((m) => this.engine.isVisible(m.pos))
        .sort((a, b) => Math.max(Math.abs(a.pos.x - hero.pos.x), Math.abs(a.pos.y - hero.pos.y))
          - Math.max(Math.abs(b.pos.x - hero.pos.x), Math.abs(b.pos.y - hero.pos.y)))[0];
      this.targeting = { kind: 'spell', spell, cursor: { ...(near ? near.pos : hero.pos) } };
      this.refresh();
      return;
    }
    this.act(() => this.engine.cast(spell));
  }

  private startRanged(): void {
    const targets = this.engine.rangedTargets();
    if (targets.length === 0) { this.toast('No ranged target in sight.'); return; }
    this.targeting = { kind: 'ranged', targets, index: 0 };
    this.refresh();
  }

  private confirmTargeting(): void {
    const t = this.targeting;
    if (!t) return;
    this.targeting = null;
    if (t.kind === 'spell') {
      const { spell, cursor } = t;
      this.act(() => this.engine.cast(spell, cursor));
    } else {
      const id = t.targets[t.index].id;
      this.act(() => this.engine.rangedAttack(id));
    }
  }

  private toggleHelp(open: boolean): void {
    this.helpOpen = open;
    this.helpC.setVisible(open);
  }

  private toast(msg: string): void {
    this.toastMsg = msg;
    this.updateHud();
    this.time.delayedCall(1800, () => {
      if (this.toastMsg === msg) {
        this.toastMsg = '';
        this.updateHud();
      }
    });
  }

  // ---------- Acting and animating ----------

  /** Runs an engine action (once input is free) and animates the events it produced. */
  private act(fn: () => EngineEvent[]): void {
    if (this.busy || this.ended) return;
    this.play(fn());
  }

  private play(events: EngineEvent[]): void {
    this.busy = true;
    let i = 0;
    const step = (): void => {
      while (i < events.length) {
        const ev = events[i++];
        if (ev.kind === 'log') continue;

        if (ev.kind === 'move') {
          const img = this.spriteOf(ev.id);
          if (!img) continue;
          const c = centre(ev.to);
          this.tweens.add({ targets: img, x: c.x, y: c.y, duration: MOVE_MS, onComplete: step });
          return;
        }

        if (ev.kind === 'attack') {
          const img = this.spriteOf(ev.targetId);
          if (img) {
            if (ev.hit) {
              const flash = this.add.rectangle(img.x, img.y, img.displayWidth, img.displayHeight, 0xffffff, 0.9);
              this.worldC.add(flash);
              this.tweens.add({ targets: flash, alpha: 0, duration: 150, onComplete: () => flash.destroy() });
              this.floatText(img.x, img.y, `-${ev.damage}${ev.crit ? '!' : ''}`);
            } else {
              this.floatText(img.x, img.y, 'miss');
            }
          }
          this.time.delayedCall(180, step);
          return;
        }

        if (ev.kind === 'death') {
          const img = this.spriteOf(ev.id);
          if (img) {
            this.tweens.add({ targets: img, alpha: 0, duration: ev.boss ? 500 : 200, onComplete: step });
            return;
          }
        }
      }

      this.busy = false;
      this.refresh();
      this.updateHud();
      const outcome = this.engine.outcome;
      if (outcome) this.endDungeon(outcome);
    };
    step();
  }

  private spriteOf(id: string): Phaser.GameObjects.Image | undefined {
    return id === 'hero' ? this.heroSprite : this.monsterSprites.get(id);
  }

  private floatText(x: number, y: number, msg: string): void {
    const t = this.add.text(x, y - 10, msg, text(10)).setOrigin(0.5);
    this.worldC.add(t);
    this.tweens.add({ targets: t, y: y - 28, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  // ---------- Rendering ----------

  /** Syncs sprites, fog and cursor with engine state. Call only when not animating. */
  private refresh(): void {
    const e = this.engine;

    for (let i = 0; i < this.tileSprites.length; i++) {
      const img = this.tileSprites[i];
      if (!img) continue;
      img.setAlpha(e.visible.has(i) ? 1 : e.explored.has(i) ? 0.3 : 0);
    }

    for (const m of e.monsters) {
      const img = this.monsterSprites.get(m.id);
      if (!img) continue;
      const c = centre(m.pos);
      img.setPosition(c.x, c.y);
      img.setVisible(m.hp > 0 && e.isVisible(m.pos));
    }

    const hc = centre(e.hero.pos);
    this.heroSprite.setPosition(hc.x, hc.y);

    for (const t of this.treasureSprites) {
      const here = e.remainingTreasure.some((r) => same(r.pos, t.pos));
      t.img.setVisible(here && e.isVisible(t.pos));
      const c = centre(t.pos);
      t.img.setPosition(c.x, c.y);
    }

    this.drawCursor();
  }

  private drawCursor(): void {
    const g = this.cursorGfx;
    g.clear();
    const t = this.targeting;
    if (!t) return;
    const p = t.kind === 'spell' ? t.cursor : t.targets[t.index].pos;
    const x = p.x * TILE;
    const y = p.y * TILE;
    const a = 4;
    const corners: Array<[number, number, number, number]> = [
      [x + 1, y + 1, 1, 1],
      [x + TILE - 1, y + 1, -1, 1],
      [x + 1, y + TILE - 1, 1, -1],
      [x + TILE - 1, y + TILE - 1, -1, -1],
    ];
    g.lineStyle(1, 0xffffff, 1);
    for (const [px, py, sx, sy] of corners) {
      g.lineBetween(px, py, px + sx * a, py);
      g.lineBetween(px, py, px, py + sy * a);
    }
  }

  private updateHud(): void {
    const e = this.engine;
    const h = e.hero;
    const info = CLASS_INFO[h.classId];
    const combat = e.mode === 'combat';

    this.hud.top.setText(`${h.name} · ${info.name} · Lv ${h.level} · HP ${meter(h.hp, h.maxHp)} ${h.hp}/${h.maxHp} · AC ${h.ac}`);
    this.hud.stats.setText(
      `Gold ${h.carriedGold} carried (${h.gold} banked) · Torches ${h.torches} · Light ${meter(e.torchRoundsLeft, TORCH_TURNS)}${e.isDark ? ' DARK' : ''}`,
    );

    const move = combat ? `Move ${e.remainingMovement}/${h.speed}` : `Move ${e.exploreStepCount}/6`;
    const action = `Action ${e.actionAvailable ? '✓' : '✗'}`;
    this.hud.mode.setText(`${combat ? 'COMBAT' : 'EXPLORE'} — ${move} · ${action}${combat ? `   Round ${e.roundNumber}` : ''}`);

    if (combat) {
      const rows = e.initiativeOrder.map(({ creature, initiative, current }) =>
        `${current ? '▶' : ' '} ${creature.name.slice(0, 12).padEnd(12)} ${String(initiative).padStart(2)}`);
      this.hud.panel.setText(['INITIATIVE', '', ...rows].join('\n'));
    } else {
      this.hud.panel.setText(['No enemies aware.', '', 'Keep to the shadows,', 'or strike first.'].join('\n'));
    }

    const recent = e.log.slice(-LOG_ROWS);
    this.hud.logs.forEach((t, row) => {
      const line = recent[row - (LOG_ROWS - recent.length)] ?? '';
      const newest = row === LOG_ROWS - 1;
      t.setText(line);
      t.setColor(newest ? '#ffffff' : '#888888');
    });

    this.hud.prompt.setText(this.promptText());
  }

  private promptText(): string {
    const t = this.targeting;
    if (!t) return this.toastMsg;
    if (t.kind === 'ranged') {
      const m = t.targets[t.index];
      return `Target ${m.name} (${t.index + 1}/${t.targets.length}) · TAB cycle · ENTER fire · ESC cancel`;
    }
    const name = SPELLS[t.spell].name;
    return `${name}: move cursor · ENTER cast · ESC cancel`;
  }

  // ---------- Overlays ----------

  private showTitle(theme: DungeonSceneData['match']['theme']): void {
    const info = THEME_INFO[theme];
    this.titleOpen = true;
    const c = this.add.container(0, 0);
    this.overlayC.add(c);
    c.add(this.add.rectangle(0, 0, 960, 640, 0x000000, 1).setOrigin(0, 0));
    c.add(this.add.text(480, 240, info.name.toUpperCase(), text(32)).setOrigin(0.5));
    c.add(this.add.text(480, 300, info.description, { ...text(15), wordWrap: { width: 640 }, align: 'center' }).setOrigin(0.5, 0));
    c.add(this.add.text(480, 420, 'press any key', text(12, '#888888')).setOrigin(0.5));
    this.time.delayedCall(2000, () => { if (this.titleOpen) this.closeTitle(c); });
    this.titleC = c;
  }

  private closeTitle(c?: Phaser.GameObjects.Container): void {
    const box = c ?? this.titleC;
    this.titleOpen = false;
    if (!box) return;
    this.tweens.add({ targets: box, alpha: 0, duration: 500, onComplete: () => box.destroy() });
    this.titleC = undefined;
  }

  private endDungeon(outcome: 'escaped' | 'died'): void {
    this.ended = true;
    this.targeting = null;
    const msg = outcome === 'escaped' ? 'You climb back to the stars...' : 'Darkness takes you...';
    const c = this.add.container(0, 0);
    this.overlayC.add(c);
    c.add(this.add.rectangle(0, 0, 960, 640, 0x000000, 1).setOrigin(0, 0));
    c.add(this.add.text(480, 300, msg, text(22)).setOrigin(0.5));
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 500 });
    this.time.delayedCall(2400, () => this.finishDelve(outcome));
  }

  private finishDelve(outcome: 'escaped' | 'died'): void {
    const state = getCampaign();
    const rng = createRng((this.seed ^ 0x5bd1e995) >>> 0);
    const report = endDelve(state, outcome, this.entry.match.theme, rng);
    saveCampaign();
    this.scene.start('Camp', { report });
  }
}
