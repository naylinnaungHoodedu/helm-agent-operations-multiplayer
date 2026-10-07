import Phaser from "phaser";
import { ControlRoomScene } from "./ControlRoomScene";

export const createPhaserGame = (parent: string | HTMLElement) =>
  new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    transparent: true,
    scene: [ControlRoomScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1600,
      height: 900
    }
  });
