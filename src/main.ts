import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { CampScene } from './scenes/CampScene';
import { SkyScene } from './scenes/SkyScene';
import { DungeonScene } from './scenes/DungeonScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#000000',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, CampScene, SkyScene, DungeonScene],
};

new Phaser.Game(config);
