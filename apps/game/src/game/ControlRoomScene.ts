import Phaser from "phaser";

export class ControlRoomScene extends Phaser.Scene {
  private scanlines?: Phaser.GameObjects.Graphics;
  private bars: Phaser.GameObjects.Rectangle[] = [];
  private glow?: Phaser.GameObjects.Arc;

  constructor() {
    super("control-room");
  }

  create() {
    this.renderLayout(this.scale.width, this.scale.height);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.renderLayout(size.width, size.height);
    });
  }

  private renderLayout(width: number, height: number) {
    this.cameras.main.setBackgroundColor("#0A0E14");
    this.children.removeAll();

    const surface = 0x131820;
    const border = 0x1f2937;

    const frame = this.add.graphics();
    frame.lineStyle(2, border, 1);
    frame.fillStyle(surface, 0.92);
    frame.fillRoundedRect(18, 18, width - 36, height - 36, 18);
    frame.strokeRoundedRect(18, 18, width - 36, height - 36, 18);

    this.add.rectangle(width / 2, 54, width - 80, 46, surface, 0.94).setStrokeStyle(1, border, 1);
    this.add.rectangle(140, height / 2, 220, height - 160, surface, 0.94).setStrokeStyle(1, border, 1);
    this.add.rectangle(width / 2, height / 2, width - 620, height - 160, surface, 0.94).setStrokeStyle(1, border, 1);
    this.add.rectangle(width - 180, height / 2, 320, height - 160, surface, 0.94).setStrokeStyle(1, border, 1);
    this.add.rectangle(width / 2, height - 42, width - 80, 46, surface, 0.94).setStrokeStyle(1, border, 1);

    this.glow = this.add.circle(width - 165, 54, 10, 0xff2e88, 0.9);
    this.tweens.add({
      targets: this.glow,
      alpha: { from: 0.2, to: 0.9 },
      yoyo: true,
      repeat: -1,
      duration: 900
    });

    this.bars = Array.from({ length: 18 }, (_, index) =>
      this.add
        .rectangle(320 + index * 42, height - 120, 18, 40 + ((index * 13) % 90), 0x00d9ff, 0.6)
        .setOrigin(0.5, 1)
    );

    this.tweens.add({
      targets: this.bars,
      scaleY: 0.45,
      yoyo: true,
      repeat: -1,
      duration: 1200,
      ease: "Sine.InOut",
      stagger: 70
    });

    this.scanlines = this.add.graphics();
    this.scanlines.lineStyle(1, 0x233041, 0.25);
    for (let y = 90; y < height - 80; y += 18) {
      this.scanlines.lineBetween(30, y, width - 30, y);
    }
  }
}
