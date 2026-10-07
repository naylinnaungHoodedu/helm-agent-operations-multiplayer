import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    CANVAS_RENDERER: true,
    WEBGL_RENDERER: true
  },
  build: {
    chunkSizeWarningLimit: 1500
  },
  resolve: {
    alias: {
      "@helm/content-schema": r("../../packages/content-schema/src/index.ts"),
      "@helm/entity-graph": r("../../packages/entity-graph/src/index.ts"),
      "@helm/trust-ledger": r("../../packages/trust-ledger/src/index.ts"),
      "@helm/policy-engine": r("../../packages/policy-engine/src/index.ts"),
      "@helm/cards": r("../../packages/cards/src/index.ts"),
      "@helm/events": r("../../packages/events/src/index.ts"),
      "@helm/economy": r("../../packages/economy/src/index.ts"),
      "@helm/sim-core": r("../../packages/sim-core/src/index.ts"),
      "@content/packs/packs.v1.json": r("../../content/packs/packs.v1.json"),
      "@content/cards/templates.v1.json": r("../../content/cards/templates.v1.json"),
      "@content/events/cinematics.v1.json": r("../../content/events/cinematics.v1.json"),
      "@content/scenarios/scenarios.v1.json": r("../../content/scenarios/scenarios.v1.json")
    }
  },
  server: {
    fs: {
      allow: [r("../../")]
    }
  }
});
