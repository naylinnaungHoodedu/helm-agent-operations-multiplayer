import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@helm/content-schema": r("./packages/content-schema/src/index.ts"),
      "@helm/entity-graph": r("./packages/entity-graph/src/index.ts"),
      "@helm/trust-ledger": r("./packages/trust-ledger/src/index.ts"),
      "@helm/policy-engine": r("./packages/policy-engine/src/index.ts"),
      "@helm/cards": r("./packages/cards/src/index.ts"),
      "@helm/events": r("./packages/events/src/index.ts"),
      "@helm/economy": r("./packages/economy/src/index.ts"),
      "@helm/sim-core": r("./packages/sim-core/src/index.ts"),
      "@content/packs/packs.v1.json": r("./content/packs/packs.v1.json"),
      "@content/cards/templates.v1.json": r("./content/cards/templates.v1.json"),
      "@content/events/cinematics.v1.json": r("./content/events/cinematics.v1.json"),
      "@content/scenarios/scenarios.v1.json": r("./content/scenarios/scenarios.v1.json")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
