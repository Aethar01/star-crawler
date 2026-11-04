import Phaser from 'phaser';
import type { Constellation, DungeonSceneData, Sky, Star, ThemeId } from '../core/types';
import { MAX_STARS } from '../core/types';
import { generateSky } from '../core/sky';
import { createRng } from '../core/rng';
import { recognizeConstellation, validateConstellation, THEME_INFO } from '../core/constellations';

const W = 960;
const SKY_TOP = 40;
const SKY_H = 560;
const HIT_RADIUS = 14;
const FLASH_MS = 1800;
const SPECK_COUNT = 140;

const WHITE = 0xffffff;
const GREY = 0x888888;

type Action = {
  /** star appended to starIds by this action, or null for a pure pen move */
  addedStar: number | null;
  /** edge appended by this action, or null */
  edge: [number, number] | null;
  prevPen: number | null;
};

/** Offsets (relative to star centre) of the pixels that make up a star of a given brightness. */
function starCells(b: number): Array<[number, number]> {
  if (b <= 1) return [[-1, -1], [0, -1], [-1, 0], [0, 0]]; // 2x2 dot
  if (b === 2) return [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]; // 3x3 plus
  const half = b - 1; // 3 -> 5x5, 4 -> 7x7, 5 -> 9x9
  const ring = Math.max(1, half - 2);
  const cells: Array<[number, number]> = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (dx === 0 || dy === 0 || cheb === ring) cells.push([dx, dy]);
    }
  }
  return cells;
}

export class SkyScene extends Phaser.Scene {
  private sky!: Sky;
  private screen!: Array<{ x: number; y: number }>;
  private starIds!: number[];
  private edges!: Array<[number, number]>;
  private pen!: number | null;
  private history!: Action[];
  private flashMsg: string | null = null;
  private flashUntil = 0;
  private showHints = false;

  private linesGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private statusStars!: Phaser.GameObjects.Text;
  private statusMatch!: Phaser.GameObjects.Text;
  private descendBtn!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'Sky' });
  }

  init(data?: { seed?: number }): void {
    const seed = data?.seed ?? Date.now() % 1e9;
    this.sky = generateSky(seed);
    this.screen = this.sky.stars.map((s) => SkyScene.toScreen(s));
    this.starIds = [];
    this.edges = [];
    this.pen = null;
    this.history = [];
    this.flashMsg = null;
    this.showHints = false;
  }

  private static toScreen(s: Star): { x: number; y: number } {
    return { x: Math.round(s.x * W), y: Math.round(SKY_TOP + s.y * SKY_H) };
  }

  create(): void {
    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBackgroundColor('#000000');

    this.drawSpecks();
    this.drawStars();

    this.linesGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    // Top bar
    this.statusStars = this.add.text(16, 20, '', monoStyle(14, '#ffffff')).setOrigin(0, 0.5);
    this.statusMatch = this.add.text(W - 16, 20, '', monoStyle(14, '#ffffff')).setOrigin(1, 0.5);

    // Bottom bar
    const barY = 620;
    this.add
      .text(16, barY, 'Click stars to connect · click pen star to lift · Z undo · R clear · H hints · ENTER descend', monoStyle(13, '#888888'))
      .setOrigin(0, 0.5);
    this.descendBtn = this.add
      .text(W - 16, barY, '[ DESCEND ]', monoStyle(13, '#ffffff'))
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.descend());

    // Hint overlay (hidden until H)
    const lines = ['CONSTELLATION HINTS', ''];
    for (const id of Object.keys(THEME_INFO) as ThemeId[]) {
      if (id === 'unnamed') continue;
      const info = THEME_INFO[id];
      lines.push(info.name, `  ${info.hint}`, '');
    }
    this.hintText = this.add
      .text(W / 2, SKY_TOP + SKY_H / 2, lines.join('\n'), {
        ...monoStyle(14, '#ffffff'),
        align: 'center',
        backgroundColor: '#000000',
        padding: { x: 16, y: 12 },
      })
      .setOrigin(0.5)
      .setVisible(false)
      .setDepth(10);

    // Input
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.undo();
        return;
      }
      if (!p.leftButtonDown()) return;
      const id = this.nearestStar(p.x, p.y);
      if (id === null) return;
      const shift = (p.event as MouseEvent).shiftKey === true;
      if (shift) this.shiftClickStar(id);
      else this.clickStar(id);
    });

    this.input.keyboard?.on('keydown-Z', () => this.undo());
    this.input.keyboard?.on('keydown-R', () => this.clear());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.clear());
    this.input.keyboard?.on('keydown-ENTER', () => this.descend());
    this.input.keyboard?.on('keydown-H', () => {
      this.showHints = !this.showHints;
      this.hintText.setVisible(this.showHints);
    });

    this.refresh();
  }

  update(): void {
    const p = this.input.activePointer;
    const g = this.overlayGfx;
    g.clear();

    const hovered = this.nearestStar(p.x, p.y);
    if (hovered !== null && hovered !== this.pen) {
      const s = this.screen[hovered];
      this.outlineSquare(g, s.x, s.y, 9, 0xffffff, 0.6);
    }

    if (this.pen !== null) {
      const s = this.screen[this.pen];
      this.bracket(g, s.x, s.y, 12, 4);
      if (p.y >= SKY_TOP && p.y <= SKY_TOP + SKY_H) {
        this.dashed(g, s.x, s.y, p.x, p.y);
      }
    }

    if (this.flashMsg !== null && this.time.now >= this.flashUntil) {
      this.flashMsg = null;
      this.refresh();
    }
  }

  // ---------- Actions ----------

  private hasEdge(a: number, b: number): boolean {
    return this.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  /** Records an action and applies the pen/star/edge changes in one place. */
  private apply(next: { addedStar?: number; edge?: [number, number]; pen: number | null }): void {
    this.history.push({
      addedStar: next.addedStar ?? null,
      edge: next.edge ?? null,
      prevPen: this.pen,
    });
    if (next.addedStar !== undefined) this.starIds.push(next.addedStar);
    if (next.edge) this.edges.push(next.edge);
    this.pen = next.pen;
    this.refresh();
  }

  private clickStar(id: number): void {
    const pen = this.pen;

    // No pen: put it on this star, adding the star if it is new.
    if (pen === null) {
      this.apply(this.starIds.includes(id) ? { pen: id } : { addedStar: id, pen: id });
      return;
    }

    // Clicking the pen star lifts the pen.
    if (id === pen) {
      this.apply({ pen: null });
      return;
    }

    // Already connected to the pen star: just move the pen there.
    if (this.hasEdge(pen, id)) {
      this.apply({ pen: id });
      return;
    }

    // Existing star with no edge to the pen: draw an edge (closes loops).
    if (this.starIds.includes(id)) {
      this.apply({ edge: [pen, id], pen: id });
      return;
    }

    // New star: draw an edge to it, respecting MAX_STARS.
    if (this.starIds.length >= MAX_STARS) {
      this.flash(`Constellation is full (${MAX_STARS} stars)`);
      return;
    }
    this.apply({ addedStar: id, edge: [pen, id], pen: id });
  }

  /** Shift+click: move the pen to a star already in the constellation, without drawing. */
  private shiftClickStar(id: number): void {
    if (!this.starIds.includes(id)) {
      this.flash('Shift-click a star already in the constellation');
      return;
    }
    if (id === this.pen) return;
    this.apply({ pen: id });
  }

  private undo(): void {
    const action = this.history.pop();
    if (!action) return;
    if (action.edge) this.edges.pop();
    if (action.addedStar !== null) this.starIds.pop();
    this.pen = action.prevPen;
    this.refresh();
  }

  private clear(): void {
    this.starIds = [];
    this.edges = [];
    this.pen = null;
    this.history = [];
    this.refresh();
  }

  private descend(): void {
    const constellation = this.currentConstellation();
    const validity = validateConstellation(this.sky, constellation);
    if (!validity.ok) {
      this.flash(validity.reason ?? 'Not a valid constellation yet');
      return;
    }
    const match = recognizeConstellation(this.sky, constellation);
    this.scene.start('Dungeon', {
      sky: this.sky,
      constellation,
      match,
    } satisfies DungeonSceneData);
  }

  private currentConstellation(): Constellation {
    return {
      starIds: [...this.starIds],
      edges: this.edges.map(([a, b]) => [a, b] as [number, number]),
    };
  }

  private flash(msg: string): void {
    this.flashMsg = msg;
    this.flashUntil = this.time.now + FLASH_MS;
    this.refresh();
  }

  // ---------- Rendering ----------

  private refresh(): void {
    this.drawLines();
    this.statusStars.setText(`Stars: ${this.starIds.length}/${MAX_STARS}`);

    let valid = false;
    if (this.flashMsg !== null) {
      this.statusMatch.setText(truncate(this.flashMsg)).setColor('#ffffff');
    } else if (this.starIds.length === 0) {
      this.statusMatch.setText('Click a star to begin').setColor('#888888');
    } else {
      const c = this.currentConstellation();
      const validity = validateConstellation(this.sky, c);
      if (validity.ok) {
        valid = true;
        const match = recognizeConstellation(this.sky, c);
        this.statusMatch
          .setText(truncate(`${match.name} (${Math.round(match.score * 100)}%)`))
          .setColor('#ffffff');
      } else {
        this.statusMatch
          .setText(truncate(validity.reason ?? 'Not a valid constellation yet'))
          .setColor('#888888');
      }
    }

    this.descendBtn.setAlpha(valid ? 1 : 0.35);
  }

  private drawLines(): void {
    const g = this.linesGfx;
    g.clear();
    g.lineStyle(2, WHITE, 1);
    for (const [a, b] of this.edges) {
      const p = this.screen[a];
      const q = this.screen[b];
      g.lineBetween(p.x, p.y, q.x, q.y);
    }
  }

  private drawSpecks(): void {
    const rng = createRng((this.sky.seed ^ 0x5f3759df) >>> 0);
    const g = this.add.graphics();
    for (let i = 0; i < SPECK_COUNT; i++) {
      const x = rng.int(0, W - 1);
      const y = rng.int(SKY_TOP, SKY_TOP + SKY_H - 1);
      const a = 0.15 + rng.next() * 0.35;
      g.fillStyle(GREY, a);
      g.fillRect(x, y, 1, 1);
    }
  }

  private drawStars(): void {
    for (const star of this.sky.stars) {
      const { x, y } = this.screen[star.id];
      const color = star.brightness <= 2 ? GREY : WHITE;
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      for (const [dx, dy] of starCells(star.brightness)) {
        g.fillRect(x + dx, y + dy, 1, 1);
      }
      if (star.brightness >= 4) {
        this.tweens.add({
          targets: g,
          alpha: 0.45,
          duration: 900 + ((star.id * 173) % 900),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  private nearestStar(px: number, py: number): number | null {
    let best: number | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < this.screen.length; i++) {
      const dx = this.screen[i].x - px;
      const dy = this.screen[i].y - py;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private bracket(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, arm: number): void {
    g.fillStyle(WHITE, 1);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = cx + sx * r;
        const y = cy + sy * r;
        g.fillRect(sx < 0 ? x : x - arm + 1, y, arm, 1);
        g.fillRect(x, sy < 0 ? y : y - arm + 1, 1, arm);
      }
    }
  }

  private outlineSquare(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    const size = 2 * r + 1;
    g.fillStyle(color, alpha);
    g.fillRect(cx - r, cy - r, size, 1);
    g.fillRect(cx - r, cy + r, size, 1);
    g.fillRect(cx - r, cy - r, 1, size);
    g.fillRect(cx + r, cy - r, 1, size);
  }

  private dashed(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;
    const ux = dx / len;
    const uy = dy / len;
    g.lineStyle(1, WHITE, 0.6);
    for (let d = 10; d < len; d += 6) {
      const e = Math.min(d + 3, len);
      g.lineBetween(
        Math.round(x1 + ux * d),
        Math.round(y1 + uy * d),
        Math.round(x1 + ux * e),
        Math.round(y1 + uy * e),
      );
    }
  }
}

/** Keeps the top-bar status clear of the "Stars: n/10" counter on the left. */
const STATUS_MAX_CHARS = 48;
function truncate(text: string): string {
  return text.length > STATUS_MAX_CHARS ? `${text.slice(0, STATUS_MAX_CHARS - 1)}…` : text;
}

function monoStyle(size: number, color: string): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: 'monospace', fontSize: `${size}px`, color };
}
