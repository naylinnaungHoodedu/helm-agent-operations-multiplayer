import type { ApprovalCardV1, AlarmV1, CardDecision, CardSeverity } from "@helm/cards";
import { allowedDecisionsForSeverity, severityWeight, sortCardsByPriority } from "@helm/cards";
import type {
  CardTemplateV1,
  GameContentBundle,
  PackDefinitionV1,
  ScenarioDefinitionV1,
  ScenarioId
} from "@helm/content-schema";
import { parseGameContentBundle } from "@helm/content-schema";
import { calculateBurnRate, calculateMonthlyRevenue, calculateValuation } from "@helm/economy";
import type {
  AgentRecord,
  CustomerRecord,
  EntityKind,
  EntityRef,
  PackId,
  PackUnlockState,
  TrendPoint
} from "@helm/entity-graph";
import { PACK_ENTITY_KIND, PACK_IDS, PACK_SHORT_NAMES } from "@helm/entity-graph";
import type { CatastrophicEventResultV1 } from "@helm/events";
import { findEventScript, toCatastrophicResult } from "@helm/events";
import type { PolicyRuleV1 } from "@helm/policy-engine";
import { matchPolicy, suggestPolicyFromCard, trackPolicyDecision } from "@helm/policy-engine";
import type { AnomalyRecordV1, LedgerEntryV1 } from "@helm/trust-ledger";
import { calculateTrustBreakdown, detectAnomalies } from "@helm/trust-ledger";

export type RngSeed = number;

export interface GameClock {
  totalHours: number;
  day: number;
  hour: number;
  quarter: number;
  year: number;
  label: string;
}

export interface WorldDelta {
  spawnedCards: number;
  resolvedCards: number;
  triggeredEvents: string[];
  trustDelta: number;
  queueDepth: number;
  notifications: WorldNotification[];
}

export interface TickResult {
  snapshot: WorldSnapshot;
  delta: WorldDelta;
}

export interface SaveGameV1 {
  schemaVersion: 1;
  scenarioId: ScenarioId;
  savedAtIso: string;
  world: WorldState;
}

export interface PackRuntime {
  definition: PackDefinitionV1;
  eventRatePerHour: number;
}

export interface WorldState {
  schemaVersion: 1;
  scenarioId: ScenarioId;
  seed: RngSeed;
  rngState: number;
  tickCount: number;
  clock: GameClock;
  trust: number;
  cash: number;
  arr: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  queue: ApprovalCardV1[];
  alarms: AlarmV1[];
  ledger: LedgerEntryV1[];
  anomalies: AnomalyRecordV1[];
  catastrophicHistory: CatastrophicEventResultV1[];
  policies: PolicyRuleV1[];
  packs: Record<PackId, PackUnlockState>;
  agents: AgentRecord[];
  customers: CustomerRecord[];
  trends: TrendPoint[];
  grantedMilestones: string[];
  lastTrustDelta: number;
  valuation: number;
}

export type WorldSnapshot = Readonly<WorldState>;

export interface CreateWorldInput {
  seed?: number;
  scenarioId?: ScenarioId;
  content: ContentInput;
}

export interface GameDecisionInput {
  cardId: string;
  decision: Exclude<CardDecision, "ack">;
  createPolicy?: boolean;
}

export type ContentInput =
  | {
      packs: unknown;
      cards: unknown;
      events: unknown;
      scenarios: unknown;
    }
  | GameContentBundle;

export interface WorldNotification {
  id: string;
  kind: "milestone" | "unlock" | "catastrophe" | "system";
  severity: "info" | "success" | "warning" | "critical";
  title: string;
  message: string;
  packId?: PackId;
}

const DEFAULT_SCENARIO_ID: ScenarioId = "standard";
export const PUBLIC_DEMO_SCENARIO_ID: ScenarioId = "public-demo";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createPackRecord = <T>(factory: () => T): Record<PackId, T> => ({
  pack_1_cfo: factory(),
  pack_2_relocation: factory(),
  pack_3_elder: factory(),
  pack_4_localization: factory(),
  pack_5_permit: factory(),
  pack_6_supplier: factory(),
  pack_7_data: factory(),
  pack_8_clinical: factory(),
  pack_9_treasury: factory()
});

const createClock = (totalHours: number): GameClock => {
  const day = Math.floor(totalHours / 24) + 1;
  const hour = totalHours % 24;
  const quarter = Math.min(4, Math.floor(day / 90) + 1);
  const year = 2027 + Math.floor(day / 365);
  return {
    totalHours,
    day,
    hour,
    quarter,
    year,
    label: `Q${quarter} ${year} | Day ${day} | ${String(hour).padStart(2, "0")}:00`
  };
};

const mulberry32 = (state: number) => {
  let value = state + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const nextRandom = (state: number) => {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  return { value: mulberry32(state), state: nextState };
};

const ensureContentBundle = (content: ContentInput): GameContentBundle =>
  Array.isArray((content as GameContentBundle).packs)
    ? (content as GameContentBundle)
    : parseGameContentBundle(content as { packs: unknown; cards: unknown; events: unknown; scenarios: unknown });

const getScenarioDefinition = (bundle: GameContentBundle, scenarioId: ScenarioId = DEFAULT_SCENARIO_ID) => {
  const scenario = bundle.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) {
    throw new Error(`Missing scenario definition for ${scenarioId}`);
  }
  return scenario;
};

const isPackFrozen = (pack: PackUnlockState, totalHours: number) =>
  pack.freezeUntilHour !== null && pack.freezeUntilHour > totalHours;

const hoursRemainingForPack = (pack: PackUnlockState, totalHours: number) =>
  pack.freezeUntilHour === null ? 0 : Math.max(0, pack.freezeUntilHour - totalHours);

const createNotification = (
  world: WorldState,
  input: Omit<WorldNotification, "id">
): WorldNotification => ({
  id: `${input.kind}_${world.tickCount}_${input.packId ?? "global"}_${input.title.toLowerCase().replace(/\s+/g, "_")}`,
  ...input
});

const createEmptyDelta = (queueDepth: number, overrides: Partial<WorldDelta> = {}): WorldDelta => ({
  spawnedCards: 0,
  resolvedCards: 0,
  triggeredEvents: [],
  trustDelta: 0,
  queueDepth,
  notifications: [],
  ...overrides
});

const createCustomer = (id: number, totalHours: number, activePacks: PackId[]): CustomerRecord => ({
  id: `cust_${id}`,
  kind: "customer",
  label: `Customer ${id}`,
  tenantId: `tenant_${(id % 5) + 1}`,
  packId: activePacks[0] ?? "pack_1_cfo",
  complianceModes: [],
  createdAtHour: totalHours,
  updatedAtHour: totalHours,
  version: 1,
  provenanceChain: ["lead_import", "salesforce_sync"],
  auditLog: ["customer_created"],
  name: `Customer ${id}`,
  joinedAtHour: totalHours,
  trustWithHelm: 86,
  lifetimeValue: 12000 + id * 120,
  activePacks
});

const createAgent = (packId: PackId, index: number, unlocked: boolean): AgentRecord => ({
  agentId: `${PACK_SHORT_NAMES[packId].toLowerCase()}_${index}`,
  name: `${PACK_SHORT_NAMES[packId].toLowerCase()}_v${(index % 3) + 1}`,
  packId,
  status: unlocked ? "active" : "idle",
  reliability: 0.82 + (index % 4) * 0.03,
  confidenceCalibration: 0.81,
  hireCost: 5000 + index * 250,
  monthlyCost: 800 + index * 60,
  version: 1
});

const entityLabelForPack = (packId: PackId, index: number) => {
  switch (packId) {
    case "pack_1_cfo":
      return `INV-${2200 + index}`;
    case "pack_2_relocation":
      return `Move ${index}`;
    case "pack_3_elder":
      return `Patient ${4000 + index}`;
    case "pack_4_localization":
      return `Locale Batch ${index}`;
    case "pack_5_permit":
      return `Permit ${index}`;
    case "pack_6_supplier":
      return `Supplier ${index}`;
    case "pack_7_data":
      return `Pipeline ${index}`;
    case "pack_8_clinical":
      return `Dossier ${index}`;
    case "pack_9_treasury":
      return `Wallet ${index}`;
  }
};

const makeEntityRef = (packId: PackId, index: number, totalHours: number, complianceModes: string[]): EntityRef => ({
  id: `${PACK_ENTITY_KIND[packId]}_${totalHours}_${index}`,
  kind: PACK_ENTITY_KIND[packId] as EntityKind,
  label: entityLabelForPack(packId, index),
  tenantId: `tenant_${(index % 5) + 1}`,
  packId,
  phi: packId === "pack_3_elder",
  complianceModes: complianceModes as EntityRef["complianceModes"]
});

const runtimeFromDefinition = (definition: PackDefinitionV1): PackRuntime => ({
  definition,
  eventRatePerHour: definition.eventRatePerHour
});

const instantiateCard = (
  template: CardTemplateV1,
  runtime: PackRuntime,
  agent: AgentRecord,
  index: number,
  totalHours: number
): ApprovalCardV1 => ({
  id: `card_${template.id}_${totalHours}_${index}`,
  templateId: template.id,
  packId: template.packId,
  entityRef: makeEntityRef(template.packId, index, totalHours, runtime.definition.complianceModes),
  actionType: template.actionType,
  title: template.title,
  summary: template.summary,
  severity: template.severity,
  ageHours: 0,
  agentRef: {
    agentId: agent.agentId,
    name: agent.name
  },
  confidence: template.baseConfidence,
  evidence: template.evidenceHints,
  provenance: template.provenanceTemplate,
  policyReason: template.policyReason,
  allowedDecisions: allowedDecisionsForSeverity(template.severity),
  expectedDecision: template.expectedDecision,
  failureEventId: template.failureEventId,
  tags: template.tags,
  attributes: template.attributes
});

const createLedgerEntry = (
  world: WorldState,
  card: ApprovalCardV1,
  decision: string,
  success: boolean,
  trustDelta: number,
  source: "auto" | "player" | "system",
  attributedToAgent: boolean
): LedgerEntryV1 => ({
  id: `led_${world.tickCount}_${card.id}_${decision}`,
  totalHours: world.clock.totalHours,
  packId: card.packId,
  actionType: card.actionType,
  entityId: card.entityRef.id,
  agentId: card.agentRef.agentId,
  source,
  attributedToAgent,
  decision,
  success,
  trustDelta,
  notes: `agent:${card.agentRef.agentId}`
});

const buildAlarms = (world: WorldState, scenario: ScenarioDefinitionV1) => {
  const alarms: AlarmV1[] = [];
  if (world.queue.length > scenario.backlogAlarmThreshold) {
    alarms.push({
      id: `alarm_queue_${world.tickCount}`,
      packId: "pack_1_cfo",
      severity: world.queue.length > scenario.backlogAlarmThreshold + 5 ? "red" : "orange",
      source: "queue_monitor",
      message: `Queue depth elevated: ${world.queue.length} cards pending.`,
      expiresAtHour: world.clock.totalHours + 3,
      requiredAction: "Pause intake, clear high-risk cards, or capture routine work as policy."
    });
  }
  for (const packId of PACK_IDS) {
    const pack = world.packs[packId];
    if (!pack.unlocked || !isPackFrozen(pack, world.clock.totalHours)) {
      continue;
    }
    alarms.push({
      id: `alarm_freeze_${packId}_${pack.freezeUntilHour}`,
      packId,
      severity: "orange",
      source: "recovery_window",
      message: `${PACK_SHORT_NAMES[packId]} is cooling down.`,
      expiresAtHour: pack.freezeUntilHour,
      requiredAction: `${hoursRemainingForPack(pack, world.clock.totalHours)}h remain in the recovery window.`
    });
  }
  for (const anomaly of world.anomalies.filter((item) => !item.resolved)) {
    alarms.push({
      id: `alarm_${anomaly.id}`,
      packId: anomaly.packId,
      severity: anomaly.severity,
      source: "anomaly_detector",
      message: anomaly.title,
      expiresAtHour: null,
      requiredAction: anomaly.reason
    });
  }
  return alarms
    .sort((left, right) => severityWeight[right.severity] - severityWeight[left.severity])
    .slice(0, 8);
};

const refreshValuation = (world: WorldState) => {
  const enterpriseMix =
    [world.packs.pack_6_supplier, world.packs.pack_7_data, world.packs.pack_8_clinical, world.packs.pack_9_treasury].filter(
      (pack) => pack.unlocked
    ).length / 4;
  return calculateValuation(world.arr, world.trust, enterpriseMix);
};

const updateTrends = (world: WorldState) => {
  if (world.tickCount % 3 !== 0) {
    return world.trends;
  }
  const nextPoint: TrendPoint = {
    totalHours: world.clock.totalHours,
    trust: world.trust,
    cash: world.cash,
    arr: world.arr,
    queueDepth: world.queue.length
  };
  return [...world.trends.slice(-179), nextPoint];
};

const evaluatePolicies = (world: WorldState, card: ApprovalCardV1) => {
  const matched = matchPolicy(world.policies, {
    packId: card.packId,
    actionType: card.actionType,
    confidence: card.confidence,
    attributes: card.attributes,
    totalHours: world.clock.totalHours
  });
  return { matched, autoApproved: matched?.decision === "auto_approve" };
};

const createRevenueSnapshot = (bundle: GameContentBundle, packs: Record<PackId, PackUnlockState>) =>
  bundle.packs.reduce<Record<PackId, { activeCustomers: number; averageMonthlyRevenue: number }>>((acc, pack) => {
    acc[pack.id] = {
      activeCustomers: packs[pack.id].unlocked ? packs[pack.id].activeCustomers : 0,
      averageMonthlyRevenue: (pack.revenueBandMonthly[0] + pack.revenueBandMonthly[1]) / 2
    };
    return acc;
  }, createPackRecord(() => ({ activeCustomers: 0, averageMonthlyRevenue: 0 })));

const normalizePackState = (pack: PackUnlockState): PackUnlockState => ({
  ...pack,
  freezeUntilHour: pack.freezeUntilHour ?? null,
  resolvedCards: pack.resolvedCards ?? 0,
  correctDecisions: pack.correctDecisions ?? 0,
  policiesCreated: pack.policiesCreated ?? 0
});

const applyScenarioMilestones = (world: WorldState, scenario: ScenarioDefinitionV1) => {
  let nextWorld = world;
  const notifications: WorldNotification[] = [];

  for (const milestone of scenario.grantMilestones) {
    if (nextWorld.grantedMilestones.includes(milestone.id) || nextWorld.clock.totalHours < milestone.triggerHour) {
      continue;
    }
    nextWorld = {
      ...nextWorld,
      cash: Number((nextWorld.cash + milestone.cashGrant).toFixed(2)),
      trust: clamp(Number((nextWorld.trust + milestone.trustBonus).toFixed(2)), 0, 100),
      grantedMilestones: [...nextWorld.grantedMilestones, milestone.id]
    };
    notifications.push(
      createNotification(nextWorld, {
        kind: "milestone",
        severity: "success",
        title: milestone.title,
        message: `${milestone.note} +${milestone.cashGrant.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0
        })}.`
      })
    );
  }

  return { world: nextWorld, notifications };
};

const applyCatastrophe = (
  world: WorldState,
  content: GameContentBundle,
  card: ApprovalCardV1
): { world: WorldState; event?: CatastrophicEventResultV1 } => {
  if (!card.failureEventId) {
    return { world };
  }
  const script = findEventScript(content.events, card.failureEventId);
  if (!script) {
    return { world };
  }
  const event = toCatastrophicResult(script, world.clock.totalHours);
  const freezeUntilHour =
    script.freezePackHours > 0
      ? Math.max(world.packs[script.packId].freezeUntilHour ?? 0, world.clock.totalHours + script.freezePackHours)
      : world.packs[script.packId].freezeUntilHour;
  return {
    world: {
      ...world,
      trust: clamp(Number((world.trust + script.trustPenalty).toFixed(2)), 0, 100),
      cash: Number((world.cash - script.cashPenalty).toFixed(2)),
      catastrophicHistory: [...world.catastrophicHistory, event],
      packs: {
        ...world.packs,
        [script.packId]: {
          ...world.packs[script.packId],
          freezeUntilHour
        }
      }
    },
    event
  };
};

const canCreatePolicyFromCard = (card: ApprovalCardV1, decision: Exclude<CardDecision, "ack">) =>
  decision === "approve" &&
  card.allowedDecisions.includes("approve") &&
  (card.severity === "yellow" || card.severity === "orange");

const isDecisionAllowed = (card: ApprovalCardV1, decision: Exclude<CardDecision, "ack">) =>
  card.allowedDecisions.includes(decision);

const appendAlarm = (world: WorldState, alarm: AlarmV1): WorldState => ({
  ...world,
  alarms: [alarm, ...world.alarms].slice(0, 8)
});

const resolveAgentAnomalies = (world: WorldState, agentId: string): WorldState => ({
  ...world,
  anomalies: world.anomalies.map((anomaly) =>
    anomaly.agentId === agentId ? { ...anomaly, resolved: true } : anomaly
  )
});

const setAgentStatus = (world: WorldState, agentId: string, status: AgentRecord["status"]): WorldState => ({
  ...world,
  agents: world.agents.map((agent) => (agent.agentId === agentId ? { ...agent, status } : agent))
});

const updatePackProgress = (
  world: WorldState,
  packId: PackId,
  updates: Partial<Pick<PackUnlockState, "resolvedCards" | "correctDecisions" | "policiesCreated">>
): WorldState => ({
  ...world,
  packs: {
    ...world.packs,
    [packId]: {
      ...world.packs[packId],
      resolvedCards: world.packs[packId].resolvedCards + (updates.resolvedCards ?? 0),
      correctDecisions: world.packs[packId].correctDecisions + (updates.correctDecisions ?? 0),
      policiesCreated: world.packs[packId].policiesCreated + (updates.policiesCreated ?? 0)
    }
  }
});

const recomputePackState = (
  world: WorldState,
  content: GameContentBundle,
  scenario: ScenarioDefinitionV1
): Record<PackId, PackUnlockState> => {
  const queueByPack = world.queue.reduce<Record<PackId, number>>((acc, card) => {
    acc[card.packId] += 1;
    return acc;
  }, createPackRecord(() => 0));

  return PACK_IDS.reduce<Record<PackId, PackUnlockState>>((acc, packId) => {
    const definition = content.packs.find((pack) => pack.id === packId);
    if (!definition) {
      throw new Error(`Missing pack definition for ${packId}`);
    }

    const existing = world.packs[packId];
    const shouldGrow =
      world.clock.totalHours > 0 &&
      world.clock.totalHours % 24 === 0 &&
      existing.unlocked &&
      !isPackFrozen(existing, world.clock.totalHours);
    const dailyDemandShift =
      world.trust >= 90 ? 2 : world.trust >= scenario.unlockTrustFloor ? 1 : world.trust < 50 ? -1 : 0;
    const pressurePenalty = queueByPack[packId] > Math.max(6, Math.floor(scenario.queueSoftCap * 0.75)) ? 1 : 0;
    const nextCustomers = !existing.unlocked
      ? 0
      : shouldGrow
        ? Math.max(definition.activeCustomerFloor, existing.activeCustomers + dailyDemandShift - pressurePenalty)
        : existing.activeCustomers;

    acc[packId] = {
      ...existing,
      activeCustomers: nextCustomers,
      queuePressure: queueByPack[packId]
    };
    return acc;
  }, createPackRecord(() => ({
    unlocked: false,
    unlockCost: 0,
    activeCustomers: 0,
    queuePressure: 0,
    complianceModes: [],
    freezeUntilHour: null,
    resolvedCards: 0,
    correctDecisions: 0,
    policiesCreated: 0
  })));
};

export const createInitialWorld = ({
  seed = 42,
  scenarioId = DEFAULT_SCENARIO_ID,
  content
}: CreateWorldInput): WorldState => {
  const bundle = ensureContentBundle(content);
  const scenario = getScenarioDefinition(bundle, scenarioId);
  const runtimes = bundle.packs.map(runtimeFromDefinition);

  const packs = PACK_IDS.reduce<Record<PackId, PackUnlockState>>((acc, packId) => {
    const definition = bundle.packs.find((pack) => pack.id === packId);
    if (!definition) {
      throw new Error(`Missing pack definition for ${packId}`);
    }
    const unlocked = scenario.initialUnlockedPacks.includes(packId);
    acc[packId] = {
      unlocked,
      unlockCost: definition.unlockCost,
      activeCustomers: unlocked ? definition.activeCustomerFloor : 0,
      queuePressure: 0,
      complianceModes: definition.complianceModes,
      freezeUntilHour: null,
      resolvedCards: 0,
      correctDecisions: 0,
      policiesCreated: 0
    };
    return acc;
  }, createPackRecord(() => ({
    unlocked: false,
    unlockCost: 0,
    activeCustomers: 0,
    queuePressure: 0,
    complianceModes: [],
    freezeUntilHour: null,
    resolvedCards: 0,
    correctDecisions: 0,
    policiesCreated: 0
  })));

  const customers = Array.from({ length: 18 }, (_, index) =>
    createCustomer(
      index + 1,
      0,
      scenario.initialUnlockedPacks.slice(0, Math.min(scenario.initialUnlockedPacks.length, (index % 3) + 1))
    )
  );
  const agents = runtimes.flatMap((runtime, runtimeIndex) =>
    Array.from({ length: runtimeIndex < 3 ? 3 : 2 }, (_, index) =>
      createAgent(runtime.definition.id, index + 1, packs[runtime.definition.id].unlocked)
    )
  );

  const perPackRevenue = createRevenueSnapshot(bundle, packs);
  const arr = calculateMonthlyRevenue(perPackRevenue) * 12;

  const baseWorld: WorldState = {
    schemaVersion: 1,
    scenarioId,
    seed,
    rngState: seed,
    tickCount: 0,
    clock: createClock(0),
    trust: scenario.startingTrust,
    cash: scenario.startingCash,
    arr,
    paused: scenario.startPaused,
    speed: scenario.defaultSpeed,
    queue: [],
    alarms: [],
    ledger: [],
    anomalies: [],
    catastrophicHistory: [],
    policies: [],
    packs,
    agents,
    customers,
    trends: [],
    grantedMilestones: [],
    lastTrustDelta: 0,
    valuation: 0
  };

  return {
    ...baseWorld,
    valuation: refreshValuation(baseWorld)
  };
};

export const createSaveGame = (world: WorldState): SaveGameV1 => ({
  schemaVersion: 1,
  scenarioId: world.scenarioId,
  savedAtIso: new Date().toISOString(),
  world
});

export const hydrateSaveGame = (saveGame: SaveGameV1): WorldState => {
  const scenarioId = saveGame.scenarioId ?? saveGame.world.scenarioId ?? DEFAULT_SCENARIO_ID;
  const packs = PACK_IDS.reduce<Record<PackId, PackUnlockState>>((acc, packId) => {
    acc[packId] = normalizePackState(saveGame.world.packs[packId]);
    return acc;
  }, createPackRecord(() => ({
    unlocked: false,
    unlockCost: 0,
    activeCustomers: 0,
    queuePressure: 0,
    complianceModes: [],
    freezeUntilHour: null,
    resolvedCards: 0,
    correctDecisions: 0,
    policiesCreated: 0
  })));

  const hydrated: WorldState = {
    ...saveGame.world,
    scenarioId,
    packs,
    grantedMilestones: saveGame.world.grantedMilestones ?? [],
    valuation: 0
  };

  return {
    ...hydrated,
    valuation: refreshValuation(hydrated)
  };
};

export const createPolicyFromCard = (world: WorldState, cardId: string): WorldState => {
  const card = world.queue.find((item) => item.id === cardId);
  if (!card || !canCreatePolicyFromCard(card, "approve")) {
    return world;
  }
  const suggestion = suggestPolicyFromCard(card);
  const nextPolicy: PolicyRuleV1 = {
    id: `pol_${world.tickCount}_${card.templateId}`,
    name: suggestion.name,
    packId: suggestion.packId,
    actionType: suggestion.actionType,
    conditions: suggestion.conditions,
    decision: suggestion.decision,
    confidenceFloor: suggestion.confidenceFloor,
    expiresAtHour: world.clock.totalHours + 24 * 90,
    createdBy: "player",
    createdAtHour: world.clock.totalHours,
    stats: {
      totalMatches: 0,
      overrideRate: 0,
      trustDelta: 0
    }
  };
  return updatePackProgress(
    {
      ...world,
      policies: [...world.policies, nextPolicy]
    },
    card.packId,
    { policiesCreated: 1 }
  );
};

export const canUnlockPack = (world: WorldState, content: ContentInput, packId: PackId) => {
  const bundle = ensureContentBundle(content);
  const scenario = getScenarioDefinition(bundle, world.scenarioId);
  const pack = world.packs[packId];
  if (pack.unlocked) {
    return false;
  }
  const currentIndex = PACK_IDS.indexOf(packId);
  const previousPackUnlocked = currentIndex <= 0 ? true : world.packs[PACK_IDS[currentIndex - 1]].unlocked;
  return previousPackUnlocked && world.cash >= pack.unlockCost && world.trust >= scenario.unlockTrustFloor;
};

export const unlockPack = (world: WorldState, content: ContentInput, packId: PackId): TickResult => {
  const bundle = ensureContentBundle(content);
  const scenario = getScenarioDefinition(bundle, world.scenarioId);
  const definition = bundle.packs.find((pack) => pack.id === packId);

  if (!definition) {
    return {
      snapshot: world,
      delta: createEmptyDelta(world.queue.length)
    };
  }

  if (!canUnlockPack(world, bundle, packId)) {
    const guardedWorld = appendAlarm(world, {
      id: `alarm_unlock_${packId}_${world.tickCount}`,
      packId,
      severity: "orange",
      source: "capital",
      message: `Cannot unlock ${PACK_SHORT_NAMES[packId]} yet.`,
      expiresAtHour: world.clock.totalHours + 6,
      requiredAction: `Reach ${world.packs[packId].unlockCost.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
      })} cash and ${scenario.unlockTrustFloor} trust, then unlock from the rail.`
    });
    return {
      snapshot: guardedWorld,
      delta: createEmptyDelta(guardedWorld.queue.length, {
        notifications: [
          createNotification(guardedWorld, {
            kind: "unlock",
            severity: "warning",
            title: `${PACK_SHORT_NAMES[packId]} still locked`,
            message: `Public demo unlocks still require trust >= ${scenario.unlockTrustFloor} and enough cash on hand.`,
            packId
          })
        ]
      })
    };
  }

  const nextWorld: WorldState = {
    ...world,
    cash: Number((world.cash - world.packs[packId].unlockCost).toFixed(2)),
    packs: {
      ...world.packs,
      [packId]: {
        ...world.packs[packId],
        unlocked: true,
        activeCustomers: definition.activeCustomerFloor,
        queuePressure: 0,
        complianceModes: definition.complianceModes,
        freezeUntilHour: null
      }
    },
    agents: world.agents.map((agent) =>
      agent.packId === packId && agent.status === "idle" ? { ...agent, status: "active" } : agent
    )
  };

  const snapshot = {
    ...nextWorld,
    alarms: buildAlarms(nextWorld, scenario),
    valuation: refreshValuation(nextWorld)
  };

  return {
    snapshot,
    delta: createEmptyDelta(snapshot.queue.length, {
      notifications: [
        createNotification(snapshot, {
          kind: "unlock",
          severity: "success",
          title: `${definition.name} unlocked`,
          message: `${definition.tutorialArc} Signature risk: ${definition.signatureEventKey}.`,
          packId
        })
      ]
    })
  };
};

export const applyDecision = (
  world: WorldState,
  content: ContentInput,
  input: GameDecisionInput
): TickResult => {
  const bundle = ensureContentBundle(content);
  const scenario = getScenarioDefinition(bundle, world.scenarioId);
  const card = world.queue.find((item) => item.id === input.cardId);
  if (!card) {
    return {
      snapshot: { ...world, valuation: refreshValuation(world) },
      delta: createEmptyDelta(world.queue.length)
    };
  }

  if (!isDecisionAllowed(card, input.decision)) {
    const guardedWorld = appendAlarm(world, {
      id: `alarm_invalid_decision_${world.tickCount}_${card.id}`,
      packId: card.packId,
      severity: "red",
      source: "approval_guard",
      message: `Invalid ${input.decision} decision blocked for ${card.title}.`,
      expiresAtHour: world.clock.totalHours + 6,
      requiredAction: "Choose one of the allowed actions shown on the card."
    });
    return {
      snapshot: { ...guardedWorld, valuation: refreshValuation(guardedWorld) },
      delta: createEmptyDelta(guardedWorld.queue.length)
    };
  }

  let nextWorld = input.createPolicy && canCreatePolicyFromCard(card, input.decision) ? createPolicyFromCard(world, card.id) : world;
  const notifications: WorldNotification[] = [];
  const success = card.expectedDecision === input.decision;
  const trustDelta = success ? (input.decision === "escalate" ? 0.5 : 0.1) : -0.25;
  const trustBefore = nextWorld.trust;

  nextWorld = {
    ...nextWorld,
    queue: nextWorld.queue.filter((item) => item.id !== card.id)
  };

  const rule = matchPolicy(nextWorld.policies, {
    packId: card.packId,
    actionType: card.actionType,
    confidence: card.confidence,
    attributes: card.attributes,
    totalHours: nextWorld.clock.totalHours
  });

  if (rule) {
    nextWorld = {
      ...nextWorld,
      policies: nextWorld.policies.map((policy) =>
        policy.id === rule.id ? trackPolicyDecision(policy, card.expectedDecision, input.decision) : policy
      )
    };
  }

  nextWorld = updatePackProgress(
    {
      ...nextWorld,
      trust: clamp(Number((nextWorld.trust + trustDelta).toFixed(2)), 0, 100),
      ledger: [...nextWorld.ledger, createLedgerEntry(nextWorld, card, input.decision, success, trustDelta, "player", false)],
      lastTrustDelta: trustDelta
    },
    card.packId,
    {
      resolvedCards: 1,
      correctDecisions: success ? 1 : 0
    }
  );

  if (input.createPolicy && canCreatePolicyFromCard(card, input.decision)) {
    notifications.push(
      createNotification(nextWorld, {
        kind: "system",
        severity: "success",
        title: "Policy captured",
        message: `${card.title} is now available for auto-approval when the same pattern recurs.`,
        packId: card.packId
      })
    );
  }

  if (card.severity === "black" && input.decision !== "approve") {
    nextWorld = resolveAgentAnomalies(nextWorld, card.agentRef.agentId);
    nextWorld = setAgentStatus(
      nextWorld,
      card.agentRef.agentId,
      input.decision === "quarantine" ? "quarantined" : "active"
    );
  }

  const triggeredEvents: string[] = [];
  if (!success) {
    const catastrophe = applyCatastrophe(nextWorld, bundle, card);
    nextWorld = catastrophe.world;
    if (catastrophe.event) {
      nextWorld = {
        ...nextWorld,
        ledger: [
          ...nextWorld.ledger,
          {
            id: `led_${nextWorld.tickCount}_${catastrophe.event.id}_catastrophe`,
            totalHours: nextWorld.clock.totalHours,
            packId: catastrophe.event.packId,
            actionType: "catastrophic_event",
            entityId: card.entityRef.id,
            agentId: card.agentRef.agentId,
            source: "system",
            attributedToAgent: false,
            decision: catastrophe.event.title,
            success: false,
            trustDelta: catastrophe.event.trustPenalty,
            notes: catastrophe.event.recoveryText
          }
        ]
      };
      triggeredEvents.push(catastrophe.event.title);
      notifications.push(
        createNotification(nextWorld, {
          kind: "catastrophe",
          severity: "critical",
          title: catastrophe.event.title,
          message: `${catastrophe.event.recoveryText} ${catastrophe.event.freezePackHours > 0 ? `${PACK_SHORT_NAMES[catastrophe.event.packId]} frozen for ${catastrophe.event.freezePackHours}h.` : ""}`,
          packId: catastrophe.event.packId
        })
      );
    }
  }

  const totalTrustDelta = Number((nextWorld.trust - trustBefore).toFixed(2));
  const packs = recomputePackState(nextWorld, bundle, scenario);

  nextWorld = {
    ...nextWorld,
    packs,
    alarms: buildAlarms({ ...nextWorld, packs }, scenario),
    valuation: refreshValuation({ ...nextWorld, packs }),
    trends: updateTrends({ ...nextWorld, packs }),
    lastTrustDelta: totalTrustDelta,
    grantedMilestones: nextWorld.grantedMilestones
  };

  return {
    snapshot: nextWorld,
    delta: createEmptyDelta(nextWorld.queue.length, {
      resolvedCards: 1,
      triggeredEvents,
      trustDelta: totalTrustDelta,
      notifications
    })
  };
};

const byPack = <T>(items: T[], getPackId: (item: T) => PackId) =>
  items.reduce<Record<PackId, T[]>>((acc, item) => {
    acc[getPackId(item)].push(item);
    return acc;
  }, createPackRecord(() => [] as T[]));

interface SpawnCandidate {
  runtime: PackRuntime;
  template: CardTemplateV1;
  agent: AgentRecord;
  weight: number;
}

const weightedPick = <T>(items: Array<{ value: T; weight: number }>, rngState: number) => {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return { value: null as T | null, state: rngState };
  }

  const random = nextRandom(rngState);
  let cursor = random.value * totalWeight;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return { value: item.value, state: random.state };
    }
  }

  return { value: items[items.length - 1].value, state: random.state };
};

const buildSpawnCandidates = (
  world: WorldState,
  scenario: ScenarioDefinitionV1,
  runtimes: PackRuntime[],
  cardsByPack: Record<PackId, CardTemplateV1[]>,
  agentsByPack: Record<PackId, AgentRecord[]>
) => {
  const queueByPack = world.queue.reduce<Record<PackId, number>>((acc, card) => {
    acc[card.packId] += 1;
    return acc;
  }, createPackRecord(() => 0));
  const queueByTemplate = world.queue.reduce<Record<string, number>>((acc, card) => {
    acc[card.templateId] = (acc[card.templateId] ?? 0) + 1;
    return acc;
  }, {});
  const queueBySeverity = world.queue.reduce<Record<CardSeverity, number>>(
    (acc, card) => {
      acc[card.severity] += 1;
      return acc;
    },
    { green: 0, yellow: 0, orange: 0, red: 0, black: 0 }
  );

  const candidates: SpawnCandidate[] = [];

  for (const runtime of runtimes) {
    const packState = world.packs[runtime.definition.id];
    if (!packState.unlocked || isPackFrozen(packState, world.clock.totalHours)) {
      continue;
    }

    const templates = cardsByPack[runtime.definition.id];
    const agents = agentsByPack[runtime.definition.id];
    if (!templates.length || !agents.length) {
      continue;
    }

    templates.forEach((template, index) => {
      let weight = runtime.eventRatePerHour * scenario.spawnRateMultiplier;
      weight *= Math.max(0.05, template.queueBias);
      weight *= scenario.severityWeights[template.severity];
      weight *= 1 + packState.activeCustomers / Math.max(1, runtime.definition.activeCustomerFloor * 4);
      weight /= 1 + queueByPack[runtime.definition.id] * 0.35;
      weight /= 1 + (queueByTemplate[template.id] ?? 0) * 1.6;

      if (template.severity === "red" || template.severity === "black") {
        weight /= 1 + queueBySeverity[template.severity] * 0.8;
      }

      if (weight <= 0) {
        return;
      }

      candidates.push({
        runtime,
        template,
        agent: agents[(world.tickCount + index + queueByPack[runtime.definition.id]) % agents.length],
        weight
      });
    });
  }

  return candidates;
};

export const tickWorld = (world: WorldState, content: ContentInput): TickResult => {
  const bundle = ensureContentBundle(content);
  const scenario = getScenarioDefinition(bundle, world.scenarioId);
  let nextWorld: WorldState = {
    ...world,
    tickCount: world.tickCount + 1,
    clock: createClock(world.clock.totalHours + 1),
    queue: world.queue.map((card) => ({ ...card, ageHours: card.ageHours + 1 }))
  };

  const runtimes = bundle.packs.map(runtimeFromDefinition);
  const cardsByPack = byPack(bundle.cards, (card) => card.packId);
  const agentsByPack = byPack(
    nextWorld.agents.filter((agent) => agent.status === "active"),
    (agent) => agent.packId
  );
  let rngState = nextWorld.rngState;
  let spawnedCards = 0;
  let autoApprovals = 0;
  const activePackCount = PACK_IDS.filter((packId) => {
    const pack = nextWorld.packs[packId];
    return pack.unlocked && !isPackFrozen(pack, nextWorld.clock.totalHours);
  }).length;

  const spawnRoll = nextRandom(rngState);
  rngState = spawnRoll.state;
  let spawnChance = scenario.spawnChancePerHour * (1 + Math.max(0, activePackCount - 3) * 0.08);
  if (nextWorld.queue.length >= scenario.queueSoftCap) {
    spawnChance *= 0.35;
  } else if (nextWorld.queue.length >= Math.floor(scenario.queueSoftCap * 0.66)) {
    spawnChance *= 0.6;
  }
  spawnChance = Math.min(0.35, spawnChance);

  if (activePackCount > 0 && spawnRoll.value <= spawnChance) {
    const candidates = buildSpawnCandidates(nextWorld, scenario, runtimes, cardsByPack, agentsByPack);
    const pick = weightedPick(
      candidates.map((candidate) => ({ value: candidate, weight: candidate.weight })),
      rngState
    );
    rngState = pick.state;

    if (pick.value) {
      const selectedCandidate = pick.value;
      const card = instantiateCard(
        selectedCandidate.template,
        selectedCandidate.runtime,
        selectedCandidate.agent,
        nextWorld.tickCount,
        nextWorld.clock.totalHours
      );
      const policyResult = evaluatePolicies(nextWorld, card);

      if (policyResult.autoApproved) {
        autoApprovals += 1;
        nextWorld = updatePackProgress(
          {
            ...nextWorld,
            ledger: [...nextWorld.ledger, createLedgerEntry(nextWorld, card, "auto_approve", true, 0.05, "auto", true)],
            agents: nextWorld.agents.map((agent) =>
              agent.agentId === selectedCandidate.agent.agentId
                ? { ...agent, reliability: Math.min(0.99, Number((agent.reliability + 0.002).toFixed(3))) }
                : agent
            )
          },
          card.packId,
          {
            resolvedCards: 1,
            correctDecisions: 1
          }
        );
        if (policyResult.matched) {
          nextWorld = {
            ...nextWorld,
            policies: nextWorld.policies.map((policy) =>
              policy.id === policyResult.matched?.id
                ? { ...policy, stats: { ...policy.stats, totalMatches: policy.stats.totalMatches + 1 } }
                : policy
            )
          };
        }
      } else {
        spawnedCards += 1;
        nextWorld = {
          ...nextWorld,
          queue: sortCardsByPriority([...nextWorld.queue, card])
        };
      }
    }
  }

  const unresolvedAnomalies = nextWorld.anomalies.filter((item) => !item.resolved).length;
  const anomalyLookup = Object.fromEntries(
    nextWorld.agents.map((agent) => [agent.agentId, { packId: agent.packId, reliability: agent.reliability }])
  );
  const unresolvedAnomalyIds = new Set(nextWorld.anomalies.filter((item) => !item.resolved).map((item) => item.agentId));
  const newAnomalies = detectAnomalies(
    nextWorld.ledger,
    Math.max(0, nextWorld.clock.totalHours - 24),
    unresolvedAnomalyIds,
    anomalyLookup
  );

  const trust = calculateTrustBreakdown({
    currentTrust: nextWorld.trust,
    correctActions: autoApprovals,
    cleanLatency: nextWorld.queue.length < scenario.queueSoftCap,
    backlogPenalty:
      nextWorld.queue.length >= scenario.backlogAlarmThreshold
        ? 2
        : nextWorld.queue.length >= scenario.queueSoftCap
          ? 1
          : 0,
    correctOverrides: 0,
    incorrectOverrides: 0,
    unresolvedAnomalies,
    customerNps: 70 + Math.min(20, nextWorld.trust / 5),
    complianceViolations: newAnomalies.filter((item) => item.severity === "black").length,
    catastrophicPenalty: 0
  });

  const payroll = nextWorld.agents
    .filter((agent) => agent.status === "active" || agent.status === "quarantined")
    .reduce((sum, agent) => sum + agent.monthlyCost, 0);
  const packs = recomputePackState(nextWorld, bundle, scenario);
  const perPackRevenue = createRevenueSnapshot(bundle, packs);
  const monthlyRevenue = calculateMonthlyRevenue(perPackRevenue);
  const burn = calculateBurnRate({
    perPack: perPackRevenue,
    payroll,
    compute: 1800,
    compliance: 2100,
    marketing: 900
  });

  nextWorld = {
    ...nextWorld,
    rngState,
    trust: trust.trustAfter,
    cash: Number((nextWorld.cash + monthlyRevenue / 30 / 24 - burn / 30 / 24).toFixed(2)),
    arr: Number((monthlyRevenue * 12).toFixed(2)),
    packs,
    anomalies: [...nextWorld.anomalies, ...newAnomalies].slice(-24),
    lastTrustDelta: Number(trust.totalDelta.toFixed(2))
  };

  const milestoneResult = applyScenarioMilestones(nextWorld, scenario);
  nextWorld = milestoneResult.world;
  nextWorld = {
    ...nextWorld,
    alarms: buildAlarms(nextWorld, scenario),
    trends: updateTrends(nextWorld),
    valuation: refreshValuation(nextWorld)
  };

  return {
    snapshot: nextWorld,
    delta: createEmptyDelta(nextWorld.queue.length, {
      spawnedCards,
      trustDelta: nextWorld.lastTrustDelta,
      notifications: milestoneResult.notifications
    })
  };
};
