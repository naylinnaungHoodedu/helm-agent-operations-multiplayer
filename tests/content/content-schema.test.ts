import { describe, expect, it } from "vitest";
import packsCatalog from "@content/packs/packs.v1.json";
import cardsCatalog from "@content/cards/templates.v1.json";
import eventsCatalog from "@content/events/cinematics.v1.json";
import scenariosCatalog from "@content/scenarios/scenarios.v1.json";
import { parseGameContentBundle } from "@helm/content-schema";

describe("content schema", () => {
  it("parses the full content bundle", () => {
    const bundle = parseGameContentBundle({
      packs: packsCatalog,
      cards: cardsCatalog,
      events: eventsCatalog,
      scenarios: scenariosCatalog
    });

    expect(bundle.packs).toHaveLength(9);
    expect(bundle.cards.length).toBeGreaterThanOrEqual(18);
    expect(bundle.events).toHaveLength(9);
    expect(bundle.scenarios).toHaveLength(2);
  });
});
