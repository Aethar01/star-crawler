import Phaser from 'phaser';
import { THEME_INFO } from '../core/constellations';
import { CLASS_INFO, abilityMod, xpToNext } from '../core/rules';
import type { Ability, ClassId, ThemeId } from '../core/types';
import {
  TORCH_PRICE,
  buyTorch,
  clearSave,
  getCampaign,
  hasCampaign,
  newCampaign,
  resetCampaign,
  saveCampaign,
  setCampaign,
} from '../game/campaign';

const FONT = 'monospace';
const WHITE = '#ffffff';
const GREY = '#888888';

const CLASSES: readonly ClassId[] = ['fighter', 'thief', 'priest', 'wizard'];
const ABILITIES: readonly Ability[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const NAMES: readonly string[] = [
  'Aldric Vane', 'Brenna Holt', 'Corwin Ash', 'Delphine Marr', 'Edda Thorn',
  'Fenwick Gray', 'Gwyn Harrow', 'Hesper Vale', 'Isolde Crane', 'Jorah Stone',
  'Kestrel Moor', 'Lenna Reed', 'Maddox Iron', 'Nessa Brook', 'Orrin Vell',
  'Pell Ashdown', 'Quill Renard', 'Rowan Fell', 'Sabine Dorn', 'Tamsin Wick',
];

interface TextOpts {
  size?: number;
  color?: string;
  wrap?: number;
  bold?: boolean;
}

interface CampInit {
  report?: string[];
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
const prettify = (id: string): string =>
  id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const randomName = (except?: string): string => {
  let name: string;
  do {
    name = NAMES[Math.floor(Math.random() * NAMES.length)];
  } while (name === except);
  return name;
};

export class CampScene extends Phaser.Scene {
  private report: string[] = [];
  private classIndex = 0;
  private heroName = '';
  private message = '';
  private abandonArmed = false;
  /** Objects rebuilt on every render. The campfire is not in this list. */
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private onKey?: (e: KeyboardEvent) => void;

  constructor() {
    super({ key: 'Camp' });
  }

  init(data: CampInit = {}): void {
    this.report = data.report ?? [];
    this.classIndex = 0;
    this.heroName = '';
    this.message = '';
    this.abandonArmed = false;
    this.dynamic = [];
  }

  create(): void {
    const kb = this.input.keyboard;
    this.onKey = (e: KeyboardEvent) => this.handleKey(e);
    kb?.on('keydown', this.onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onKey) kb?.off('keydown', this.onKey);
    });

    if (hasCampaign()) {
      saveCampaign();
      this.buildFire();
      this.renderCamp();
    } else {
      this.heroName = randomName();
      this.renderCreate();
    }
  }

  // ---------- Input ----------

  private handleKey(e: KeyboardEvent): void {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (hasCampaign()) this.handleCampKey(key);
    else this.handleCreateKey(key);
  }

  private handleCreateKey(key: string): void {
    if (key >= '1' && key <= '4') {
      this.classIndex = Number(key) - 1;
      this.renderCreate();
    } else if (key === 'n') {
      this.heroName = randomName(this.heroName);
      this.renderCreate();
    } else if (key === 'Enter') {
      const c = newCampaign(this.heroName, CLASSES[this.classIndex], Date.now());
      setCampaign(c);
      saveCampaign();
      this.scene.restart({ report: [] });
    }
  }

  private handleCampKey(key: string): void {
    if (key !== 'x' && this.abandonArmed) {
      this.abandonArmed = false;
      this.message = '';
      this.renderCamp();
    }

    if (key === 'd' || key === 'Enter') {
      saveCampaign();
      this.scene.start('Sky', { seed: getCampaign().nextSkySeed });
    } else if (key === 't') {
      const c = getCampaign();
      this.message = buyTorch(c)
        ? 'Bought a torch.'
        : `Not enough gold. A torch costs ${TORCH_PRICE}.`;
      saveCampaign();
      this.renderCamp();
    } else if (key === 'x') {
      if (!this.abandonArmed) {
        this.abandonArmed = true;
        this.message = `Press X again to abandon ${getCampaign().hero.name}. The campaign will be erased.`;
        this.renderCamp();
      } else {
        clearSave();
        resetCampaign();
        this.scene.restart({ report: [] });
      }
    }
  }

  // ---------- Rendering helpers ----------

  private t(x: number, y: number, value: string, opts: TextOpts = {}): Phaser.GameObjects.Text {
    const obj = this.add.text(x, y, value, {
      fontFamily: FONT,
      fontSize: `${opts.size ?? 16}px`,
      color: opts.color ?? WHITE,
      fontStyle: opts.bold ? 'bold' : undefined,
      wordWrap: opts.wrap ? { width: opts.wrap, useAdvancedWrap: true } : undefined,
    });
    this.dynamic.push(obj);
    return obj;
  }

  private clearDynamic(): void {
    for (const obj of this.dynamic) obj.destroy();
    this.dynamic = [];
  }

  private buildFire(): void {
    const x = 760;
    const y = 150;

    const logs = this.add.graphics();
    logs.lineStyle(4, 0xffffff, 1);
    logs.lineBetween(x - 26, y + 4, x + 26, y - 8);
    logs.lineBetween(x - 26, y - 8, x + 26, y + 4);
    logs.lineStyle(1, 0xffffff, 1);
    logs.lineBetween(x - 64, y + 18, x + 64, y + 18);

    const flame = this.add.graphics({ x, y: y - 6 });
    flame.fillStyle(0xffffff, 1);
    flame.fillTriangle(-18, 0, 18, 0, 0, -60);
    flame.fillStyle(0x000000, 1);
    flame.fillTriangle(-8, 0, 8, 0, 0, -26);

    this.tweens.add({
      targets: flame,
      scaleY: { from: 0.88, to: 1.1 },
      scaleX: { from: 1.06, to: 0.94 },
      duration: 160,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ---------- Character creation ----------

  private renderCreate(): void {
    this.clearDynamic();
    const W = this.scale.width;
    const H = this.scale.height;
    const left = 210;

    this.t(W / 2, 70, 'STAR CRAWLER', { size: 64, bold: true }).setOrigin(0.5, 0);
    this.t(W / 2, 150, '. * .  *  .  * .  *  .  * .', { color: GREY }).setOrigin(0.5, 0);
    this.t(W / 2, 185, 'Draw a constellation. Descend into its halls. Bring the gold home.', {
      size: 18,
      color: GREY,
    }).setOrigin(0.5, 0);

    this.t(left, 250, 'CHOOSE YOUR CLASS', { color: GREY });
    CLASSES.forEach((id, i) => {
      const info = CLASS_INFO[id];
      const selected = i === this.classIndex;
      const color = selected ? WHITE : GREY;
      const marker = selected ? '>' : ' ';
      const y = 290 + i * 56;
      this.t(left, y, `${marker} [${i + 1}] ${info.name.padEnd(9)} d${info.hitDie}`, { color });
      this.t(left + 40, y + 22, info.description, { color: GREY, wrap: 560 });
    });

    this.t(left, 532, `Name:  ${this.heroName}`);
    this.t(left, 556, '[N] reroll name', { color: GREY });

    this.t(W / 2, H - 56, '[1-4] class    [N] reroll name    [ENTER] begin', { color: GREY })
      .setOrigin(0.5, 0);
  }

  // ---------- Camp ----------

  private renderCamp(): void {
    this.clearDynamic();
    const c = getCampaign();
    const h = c.hero;
    const info = CLASS_INFO[h.classId];
    const H = this.scale.height;

    this.t(40, 24, 'CAMP', { size: 28, bold: true });

    let y = 80;
    const LABEL_X = 40;
    const VALUE_X = 170;
    const VALUE_W = 320;
    const row = (label: string, value: string): void => {
      this.t(LABEL_X, y, label, { color: GREY });
      const v = this.t(VALUE_X, y, value, { wrap: VALUE_W });
      y += Math.max(22, v.height + 6);
    };

    row('Name', h.name);
    row('Class', `${info.name}  (d${info.hitDie})`);
    row('Level', String(h.level));
    row('XP', `${h.xp} / ${xpToNext(h.level)}`);
    row('HP', `${h.hp} / ${h.maxHp}`);
    row('AC', String(h.ac));
    y += 10;

    ABILITIES.forEach((a, i) => {
      const score = h.stats[a];
      const col = i % 3;
      const line = Math.floor(i / 3);
      this.t(LABEL_X + col * 150, y + line * 24, `${a} ${String(score).padStart(2)} (${signed(abilityMod(score))})`);
    });
    y += 48 + 10;

    row('Gold', String(h.gold));
    row('Torches', String(h.torches));
    row('Spells', h.spells.length ? h.spells.map(prettify).join(', ') : 'none');
    row('Injuries', h.injuries.length ? h.injuries.join('\n') : 'none');
    row('Delves', String(c.delves));
    row('Discovered', c.discovered.length
      ? c.discovered.map((id: ThemeId) => THEME_INFO[id].name).join(', ')
      : 'none yet');

    // Report box, top right under the fire.
    const boxX = 520;
    const boxY = 240;
    const boxW = 400;
    const pad = 16;
    this.t(boxX + pad, boxY + pad - 4, 'LAST DELVE', { color: GREY });
    let ry = boxY + pad + 24;
    if (this.report.length === 0) {
      const empty = this.t(boxX + pad, ry, 'No delve yet. The fire is quiet.', { color: GREY, wrap: boxW - pad * 2 });
      ry += empty.height;
    } else {
      for (const line of this.report) {
        const r = this.t(boxX + pad, ry, line, { wrap: boxW - pad * 2 });
        ry += r.height + 6;
      }
    }
    const boxH = ry - boxY + pad - 6;
    const frame = this.add.graphics();
    frame.lineStyle(1, 0xffffff, 1);
    frame.strokeRect(boxX, boxY, boxW, boxH);
    this.dynamic.push(frame);

    // Feedback and controls.
    if (this.message) {
      this.t(40, H - 90, this.message, { wrap: 880 });
    }
    this.t(40, H - 48, '[D] / [ENTER] descend    [T] buy torch (5 gold)    [X] abandon hero', {
      color: GREY,
    });
  }
}
