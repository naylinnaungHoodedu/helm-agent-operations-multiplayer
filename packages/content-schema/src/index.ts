import { z } from "zod";

const packIdSchema = z.enum([
  "pack_1_cfo",
  "pack_2_relocation",
  "pack_3_elder",
  "pack_4_localization",
  "pack_5_permit",
  "pack_6_supplier",
  "pack_7_data",
  "pack_8_clinical",
  "pack_9_treasury"
]);

const complianceModeSchema = z.enum([
  "recordkeeping",
  "soc2",
  "hipaa",
  "brand_legal",
  "public_record",
  "iso9001",
  "fda_21cfr820",
  "data_residency",
  "cfr_part_11",
  "gcp",
  "pci_dss",
  "soc1",
  "money_transmitter"
]);

const severitySchema = z.enum(["green", "yellow", "orange", "red", "black"]);
export const scenarioIdSchema = z.enum(["standard", "public-demo"]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const packDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: packIdSchema,
  name: z.string().min(1),
  shortName: z.string().min(1),
  unlockCost: z.number().nonnegative(),
  phase: z.number().int().min(1).max(5),
  keyMechanic: z.string().min(1),
  winSignal: z.string().min(1),
  tutorialArc: z.string().min(1),
  signatureEventKey: z.string().min(1),
  complianceModes: z.array(complianceModeSchema).min(1),
  eventRatePerHour: z.number().positive(),
  activeCustomerFloor: z.number().int().nonnegative(),
  revenueBandMonthly: z.tuple([z.number().nonnegative(), z.number().nonnegative()])
});

export type PackDefinitionV1 = z.infer<typeof packDefinitionSchema>;

export const cardTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  packId: packIdSchema,
  title: z.string().min(1),
  actionType: z.string().min(1),
  entityKind: z.string().min(1),
  severity: severitySchema,
  summary: z.string().min(1),
  baseConfidence: z.number().min(0).max(1),
  policyReason: z.string().min(1),
  expectedDecision: z.enum(["approve", "edit", "reject", "escalate", "quarantine"]),
  failureEventId: z.string().nullable(),
  evidenceHints: z.array(z.string()).min(2),
  provenanceTemplate: z.array(z.string()).min(2),
  tags: z.array(z.string()).min(1),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  queueBias: z.number().min(0).max(1).default(0.5)
});

export type CardTemplateV1 = z.infer<typeof cardTemplateSchema>;

export const cinematicScriptSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  packId: packIdSchema,
  title: z.string().min(1),
  trigger: z.string().min(1),
  trustPenalty: z.number().negative(),
  cashPenalty: z.number().nonnegative(),
  freezePackHours: z.number().int().nonnegative(),
  recoveryText: z.string().min(1),
  scriptLines: z.array(z.string()).min(2)
});

export type CinematicScriptV1 = z.infer<typeof cinematicScriptSchema>;
export type EventScriptV1 = CinematicScriptV1;

export const scenarioMilestoneSchema = z.object({
  id: z.string().min(1),
  triggerHour: z.number().int().nonnegative(),
  cashGrant: z.number().nonnegative(),
  trustBonus: z.number().min(-100).max(100).default(0),
  title: z.string().min(1),
  note: z.string().min(1)
});

export type ScenarioMilestoneV1 = z.infer<typeof scenarioMilestoneSchema>;

export const scenarioDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: scenarioIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  startingCash: z.number().nonnegative(),
  startingTrust: z.number().min(0).max(100),
  defaultSpeed: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  startPaused: z.boolean(),
  initialUnlockedPacks: z.array(packIdSchema).min(1),
  unlockTrustFloor: z.number().min(0).max(100),
  spawnChancePerHour: z.number().min(0).max(1),
  spawnRateMultiplier: z.number().positive(),
  queueSoftCap: z.number().int().positive(),
  backlogAlarmThreshold: z.number().int().positive(),
  severityWeights: z.object({
    green: z.number().positive(),
    yellow: z.number().positive(),
    orange: z.number().positive(),
    red: z.number().positive(),
    black: z.number().positive()
  }),
  onboardingChecklist: z.array(z.string().min(1)).min(3),
  grantMilestones: z.array(scenarioMilestoneSchema).default([])
});

export type ScenarioDefinitionV1 = z.infer<typeof scenarioDefinitionSchema>;

export const packCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  packs: z.array(packDefinitionSchema).length(9)
});

export const cardCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  cards: z.array(cardTemplateSchema).min(18)
});

export const cinematicCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  events: z.array(cinematicScriptSchema).min(9)
});

export const scenarioCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  scenarios: z.array(scenarioDefinitionSchema).min(2)
});

export interface GameContentBundle {
  packs: PackDefinitionV1[];
  cards: CardTemplateV1[];
  events: CinematicScriptV1[];
  scenarios: ScenarioDefinitionV1[];
}

export const parsePackCatalog = (value: unknown) => packCatalogSchema.parse(value);
export const parseCardCatalog = (value: unknown) => cardCatalogSchema.parse(value);
export const parseCinematicCatalog = (value: unknown) => cinematicCatalogSchema.parse(value);
export const parseScenarioCatalog = (value: unknown) => scenarioCatalogSchema.parse(value);

export const parseGameContentBundle = (bundle: {
  packs: unknown;
  cards: unknown;
  events: unknown;
  scenarios: unknown;
}): GameContentBundle => ({
  packs: parsePackCatalog(bundle.packs).packs,
  cards: parseCardCatalog(bundle.cards).cards,
  events: parseCinematicCatalog(bundle.events).events,
  scenarios: parseScenarioCatalog(bundle.scenarios).scenarios
});
