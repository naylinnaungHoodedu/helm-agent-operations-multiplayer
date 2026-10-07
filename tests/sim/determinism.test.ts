import { describe, expect, it } from "vitest";
import packsCatalog from "@content/packs/packs.v1.json";
import cardsCatalog from "@content/cards/templates.v1.json";
import eventsCatalog from "@content/events/cinematics.v1.json";
import scenariosCatalog from "@content/scenarios/scenarios.v1.json";
import { createInitialWorld, tickWorld } from "@helm/sim-core";
import { parseGameContentBundle } from "@helm/content-schema";

describe("simulation determinism", () => {
  it("replays the same seed identically", () => {
    const content = parseGameContentBundle({
      packs: packsCatalog,
      cards: cardsCatalog,
      events: eventsCatalog,
      scenarios: scenariosCatalog
    });

    let worldA = createInitialWorld({ seed: 42, content });
    let worldB = createInitialWorld({ seed: 42, content });

    for (let index = 0; index < 24; index += 1) {
      worldA = tickWorld(worldA, content).snapshot;
      worldB = tickWorld(worldB, content).snapshot;
    }

    expect(worldA.clock.totalHours).toBe(worldB.clock.totalHours);
    expect(worldA.trust).toBe(worldB.trust);
    expect(worldA.queue.map((card) => card.id)).toEqual(worldB.queue.map((card) => card.id));
    expect(worldA.ledger.length).toBe(worldB.ledger.length);
  });
});
