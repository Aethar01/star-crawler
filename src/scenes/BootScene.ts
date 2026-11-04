import Phaser from 'phaser';
import { loadCampaign } from '../game/campaign';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  create(): void {
    loadCampaign();
    this.scene.start('Camp');
  }
}
