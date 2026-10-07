import { useEffect, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";

interface TrustGaugeProps {
  trust: number;
  lastTrustDelta?: number;
}

const WIDTH = 248;
const HEIGHT = 70;

const gaugeColor = (trust: number) => {
  if (trust >= 90) return 0x10f2a0;
  if (trust >= 75) return 0x00d9ff;
  if (trust >= 60) return 0xf2c94c;
  if (trust >= 40) return 0xff8a4c;
  return 0xff3b5c;
};

export const TrustGauge = ({ trust, lastTrustDelta }: TrustGaugeProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const [readyVersion, setReadyVersion] = useState(0);

  useEffect(() => {
    let disposed = false;

    const mount = async () => {
      const host = hostRef.current;
      if (!host) return;

      const app = new Application();
      await app.init({
        width: WIDTH,
        height: HEIGHT,
        backgroundAlpha: 0,
        antialias: true,
      });

      if (disposed) {
        app.destroy(true);
        return;
      }

      host.replaceChildren(app.canvas);
      appRef.current = app;
      setReadyVersion((current) => current + 1);
    };

    void mount();

    return () => {
      disposed = true;
      graphicsRef.current?.destroy();
      appRef.current?.destroy(true);
      if (hostRef.current) {
        hostRef.current.replaceChildren();
      }
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    if (graphicsRef.current) {
      app.stage.removeChild(graphicsRef.current);
      graphicsRef.current.destroy();
    }

    const graphics = new Graphics();
    const color = gaugeColor(trust);
    const barWidth = Math.max(0, (WIDTH - 4) * (trust / 100));

    // Track (background)
    graphics.beginFill(0x1f2937, 1);
    graphics.drawRoundedRect(0, 24, WIDTH, 20, 10);
    graphics.endFill();

    // Filled bar
    if (barWidth > 0) {
      graphics.beginFill(color, 1);
      graphics.drawRoundedRect(0, 24, barWidth, 20, 10);
      graphics.endFill();
    }

    // Critical-zone glow when trust is low
    if (trust < 40) {
      graphics.lineStyle(2, 0xff3b5c, 0.7);
      graphics.drawRoundedRect(-1, 23, WIDTH + 2, 22, 11);
    } else {
      // Normal border
      graphics.lineStyle(2, 0x8b98a5, 0.45);
      graphics.drawRoundedRect(0, 24, WIDTH, 20, 10);
    }

    // Percentage label centred on bar
    app.stage.addChild(graphics);
    graphicsRef.current = graphics;
  }, [trust, readyVersion]);

  const deltaClass =
    lastTrustDelta === undefined || lastTrustDelta === 0
      ? "trust-gauge__delta--neutral"
      : lastTrustDelta > 0
        ? "trust-gauge__delta--up"
        : "trust-gauge__delta--down";

  const deltaLabel =
    lastTrustDelta === undefined || lastTrustDelta === 0
      ? "—"
      : lastTrustDelta > 0
        ? `▲ +${lastTrustDelta.toFixed(2)}`
        : `▼ ${lastTrustDelta.toFixed(2)}`;

  return (
    <div className="trust-gauge">
      <div className="trust-gauge__header">
        <span>Trust</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <strong style={{ color: trust < 40 ? "var(--color-red)" : trust < 60 ? "var(--color-amber)" : "var(--color-green)" }}>
            {trust.toFixed(2)}
          </strong>
          <span className={`trust-gauge__delta ${deltaClass}`} title="Trust change since last tick">
            {deltaLabel}
          </span>
        </div>
      </div>
      <div ref={hostRef} className="trust-gauge__canvas" aria-label={`Trust: ${trust.toFixed(2)} out of 100`} />
    </div>
  );
};
