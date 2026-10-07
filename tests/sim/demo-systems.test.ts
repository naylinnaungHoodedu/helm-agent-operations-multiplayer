import { describe, expect, it } from "vitest";
import { allowedDecisionsForSeverity, type ApprovalCardV1 } from "@helm/cards";
import packsCatalog from "@content/packs/packs.v1.json";
import cardsCatalog from "@content/cards/templates.v1.json";
import eventsCatalog from "@content/events/cinematics.v1.json";
import scenariosCatalog from "@content/scenarios/scenarios.v1.json";
import { parseGameContentBundle, type GameContentBundle } from "@helm/content-schema";
import { calculateBurnRate, calculateMonthlyRevenue } from "@helm/economy";
import { PACK_IDS, type PackId } from "@helm/entity-graph";
import {
  applyDecision,
  canUnlockPack,
  createInitialWorld,
  tickWorld,
  unlockPack,
  type WorldState
} from "@helm/sim-core";

const content = parseGameContentBundle({
  packs: packsCatalog,
  cards: cardsCatalog,
  events: eventsCatalog,
  scenarios: scenariosCatalog
});

const createPerPackRevenue = (world: WorldState) =>
  PACK_IDS.reduce<Record<PackId, { activeCustomers: number; averageMonthlyRevenue: number }>>((acc, packId) => {
    const packDefinition = content.packs.find((pack) => pack.id === packId)!;
    acc[packId] = {
      activeCustomers: world.packs[packId].unlocked ? world.packs[packId].activeCustomers : 0,
      averageMonthlyRevenue: (packDefinition.revenueBandMonthly[0] + packDefinition.revenueBandMonthly[1]) / 2
    };
    return acc;
  }, {
    pack_1_cfo: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_2_relocation: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_3_elder: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_4_localization: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_5_permit: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_6_supplier: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_7_data: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_8_clinical: { activeCustomers: 0, averageMonthlyRevenue: 0 },
    pack_9_treasury: { activeCustomers: 0, averageMonthlyRevenue: 0 }
  });

const advanceHours = (world: WorldState, hours: number, activeContent: GameContentBundle = content) => {
  let nextWorld = world;
  for (let hour = 0; hour < hours; hour += 1) {
    nextWorld = tickWorld(nextWorld, activeContent).snapshot;
  }
  return nextWorld;
};

const isolateToPack = (world: WorldState, activePackId: PackId): WorldState => ({
  ...world,
  queue: [],
  packs: PACK_IDS.reduce<WorldState["packs"]>((acc, packId) => {
    const existing = world.packs[packId];
    acc[packId] = {
      ...existing,
      unlocked: packId === activePackId,
      activeCustomers: packId === activePackId ? Math.max(1, existing.activeCustomers) : 0,
      queuePressure: 0,
      freezeUntilHour: packId === activePackId ? existing.freezeUntilHour : null
    };
    return acc;
  }, { ...world.packs }),
  agents: world.agents.map((agent) => ({
    ...agent,
    status: agent.packId === activePackId ? "active" : "idle"
  }))
});

const createWrongDoseCard = (): ApprovalCardV1 => ({
  id: "elder_wrong_dose_test",
  templateId: "elder_warfarin_change",
  packId: "pack_3_elder",
  entityRef: {
    id: "patient_1",
    kind: "patient",
    label: "Patient 1",
    tenantId: "tenant_1",
    packId: "pack_3_elder",
    phi: true,
    complianceModes: ["hipaa"]
  },
  actionType: "increase_dose",
  title: "Warfarin dosage change",
  summary: "Medication adjustment requested after a symptom report and incomplete labs.",
  severity: "red",
  ageHours: 0,
  agentRef: {
    agentId: "elder_1",
    name: "elder_v1"
  },
  confidence: 0.74,
  evidence: ["Patient is on anticoagulants.", "Recent labs are incomplete in the chart."],
  provenance: ["patient_chart.medications", "triage_agent.symptom_summary"],
  policyReason: "Controlled medication change requires physician review.",
  allowedDecisions: allowedDecisionsForSeverity("red"),
  expectedDecision: "escalate",
  failureEventId: "event_wrong_dose",
  tags: ["signature", "medication"],
  attributes: {
    medication_type: "anticoagulant",
    days_since_last_refill: 18,
    provider_active: true
  }
});

const sampleTemplates = (activeContent: GameContentBundle, seed = 42, hours = 320) => {
  let world = isolateToPack(createInitialWorld({ seed, content: activeContent, scenarioId: "standard" }), "pack_1_cfo");
  const seen: string[] = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const result = tickWorld(world, activeContent);
    const card = result.snapshot.queue[result.snapshot.queue.length - 1];
    if (card) {
      seen.push(card.templateId);
    }
    world = { ...result.snapshot, queue: [] };
  }

  return seen;
};

const countTemplates = (templateIds: string[]) =>
  templateIds.reduce<Record<string, number>>((acc, templateId) => {
    acc[templateId] = (acc[templateId] ?? 0) + 1;
    return acc;
  }, {});

describe("public demo simulation systems", () => {
  it("keeps locked packs out of revenue, payroll, and customer growth until unlocked", () => {
    const world = createInitialWorld({ content, scenarioId: "standard" });
    const lockedPackId = "pack_6_supplier";
    const perPackRevenue = createPerPackRevenue(world);
    const monthlyRevenue = calculateMonthlyRevenue(perPackRevenue);
    const activePayroll = world.agents
      .filter((agent) => agent.status === "active" || agent.status === "quarantined")
      .reduce((sum, agent) => sum + agent.monthlyCost, 0);
    const burn = calculateBurnRate({
      perPack: perPackRevenue,
      payroll: activePayroll,
      compute: 1800,
      compliance: 2100,
      marketing: 900,
      trust: world.trust
    });

    expect(world.packs[lockedPackId].activeCustomers).toBe(0);
    expect(world.agents.filter((agent) => agent.packId === lockedPackId).every((agent) => agent.status === "idle")).toBe(
      true
    );
    expect(world.arr).toBe(monthlyRevenue * 12);

    const ticked = tickWorld(world, content);
    const expectedCash = Number((world.cash + monthlyRevenue / 30 / 24 - burn / 30 / 24).toFixed(2));
    expect(ticked.snapshot.cash).toBe(expectedCash);

    const afterDay = advanceHours(world, 24);
    expect(afterDay.packs[lockedPackId].activeCustomers).toBe(0);
  });

  it("freezes a pack after catastrophe and resumes spawning after the freeze window", () => {
    let world = isolateToPack(createInitialWorld({ seed: 9, content, scenarioId: "standard" }), "pack_3_elder");
    world = {
      ...world,
      queue: [createWrongDoseCard()]
    };

    const failedDecision = applyDecision(world, content, {
      cardId: "elder_wrong_dose_test",
      decision: "edit"
    });

    expect(failedDecision.snapshot.catastrophicHistory.map((event) => event.id)).toContain("event_wrong_dose");
    expect(failedDecision.snapshot.packs.pack_3_elder.freezeUntilHour).toBe(96);

    let frozenWorld = failedDecision.snapshot;
    for (let hour = 0; hour < 95; hour += 1) {
      frozenWorld = tickWorld(frozenWorld, content).snapshot;
      expect(frozenWorld.queue).toHaveLength(0);
    }

    let resumedWorld = frozenWorld;
    let sawResumedCard = false;
    for (let hour = 0; hour < 240; hour += 1) {
      resumedWorld = tickWorld(resumedWorld, content).snapshot;
      if (resumedWorld.queue.some((card) => card.packId === "pack_3_elder")) {
        sawResumedCard = true;
        break;
      }
    }

    expect(sawResumedCard).toBe(true);
  });

  it("keeps weighted spawning deterministic and responds to queueBias changes", () => {
    const baselineA = sampleTemplates(content, 42, 360);
    const baselineB = sampleTemplates(content, 42, 360);
    const baselineCounts = countTemplates(baselineA);
    const biasedContent: GameContentBundle = {
      ...content,
      cards: content.cards.map((card) => {
        if (card.id === "cfo_routine_invoice") {
          return { ...card, queueBias: 0.05 };
        }
        if (card.id === "cfo_tax_filing") {
          return { ...card, queueBias: 1 };
        }
        return card;
      })
    };
    const biasedCounts = countTemplates(sampleTemplates(biasedContent, 42, 360));

    expect(baselineA).toEqual(baselineB);
    expect((baselineCounts.cfo_routine_invoice ?? 0)).toBeGreaterThan(baselineCounts.cfo_tax_filing ?? 0);
    expect((biasedCounts.cfo_tax_filing ?? 0)).toBeGreaterThan(biasedCounts.cfo_routine_invoice ?? 0);
  });

  it("unlocks all nine packs inside the public-demo session envelope", () => {
    let world = createInitialWorld({ seed: 42, content, scenarioId: "public-demo" });
    const trustHistory = [world.trust];
    let sawFailureModeCard = false;

    while (world.clock.totalHours <= 2160 && PACK_IDS.some((packId) => !world.packs[packId].unlocked)) {
      let resolutionBudget = 12;
      while (world.queue.length > 0 && resolutionBudget > 0) {
        const card = world.queue[0];
        if (card.failureEventId) {
          sawFailureModeCard = true;
        }

        const result = applyDecision(world, content, {
          cardId: card.id,
          decision: card.expectedDecision,
          createPolicy: card.expectedDecision === "approve" && (card.severity === "yellow" || card.severity === "orange")
        });
        world = result.snapshot;
        trustHistory.push(world.trust);
        resolutionBudget -= 1;
      }

      let nextLockedPack = PACK_IDS.find((packId) => !world.packs[packId].unlocked);
      while (nextLockedPack && canUnlockPack(world, content, nextLockedPack)) {
        world = unlockPack(world, content, nextLockedPack).snapshot;
        nextLockedPack = PACK_IDS.find((packId) => !world.packs[packId].unlocked);
      }

      world = tickWorld(world, content).snapshot;
      trustHistory.push(world.trust);
    }

    expect(PACK_IDS.every((packId) => world.packs[packId].unlocked)).toBe(true);
    expect(world.clock.totalHours).toBeLessThanOrEqual(2160);
    expect(sawFailureModeCard).toBe(true);
    expect(Math.max(...trustHistory)).toBeGreaterThan(Math.min(...trustHistory));
  });
});
