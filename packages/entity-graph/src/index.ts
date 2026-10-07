export const PACK_IDS = [
  "pack_1_cfo",
  "pack_2_relocation",
  "pack_3_elder",
  "pack_4_localization",
  "pack_5_permit",
  "pack_6_supplier",
  "pack_7_data",
  "pack_8_clinical",
  "pack_9_treasury"
] as const;

export type PackId = (typeof PACK_IDS)[number];

export const COMPLIANCE_MODES = [
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
] as const;

export type ComplianceMode = (typeof COMPLIANCE_MODES)[number];

export const ENTITY_KINDS = [
  "customer",
  "invoice",
  "expense",
  "move",
  "patient",
  "localization_job",
  "permit",
  "supplier",
  "etl_pipeline",
  "clinical_submission",
  "wallet"
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  id: string;
  kind: EntityKind;
  label: string;
  tenantId: string;
  packId: PackId;
  phi?: boolean;
  complianceModes: ComplianceMode[];
}

export interface BaseEntityRecord extends EntityRef {
  createdAtHour: number;
  updatedAtHour: number;
  version: number;
  provenanceChain: string[];
  auditLog: string[];
}

export interface CustomerRecord extends BaseEntityRecord {
  kind: "customer";
  name: string;
  joinedAtHour: number;
  trustWithHelm: number;
  lifetimeValue: number;
  activePacks: PackId[];
}

export interface AgentRecord {
  agentId: string;
  name: string;
  packId: PackId;
  status: "active" | "idle" | "quarantined" | "retired";
  reliability: number;
  confidenceCalibration: number;
  hireCost: number;
  monthlyCost: number;
  version: number;
}

export interface PackUnlockState {
  unlocked: boolean;
  unlockCost: number;
  activeCustomers: number;
  queuePressure: number;
  complianceModes: ComplianceMode[];
  freezeUntilHour: number | null;
  resolvedCards: number;
  correctDecisions: number;
  policiesCreated: number;
}

export interface TrendPoint {
  totalHours: number;
  trust: number;
  cash: number;
  arr: number;
  queueDepth: number;
}

export const PACK_SHORT_NAMES: Record<PackId, string> = {
  pack_1_cfo: "CFO",
  pack_2_relocation: "Reloc",
  pack_3_elder: "Elder",
  pack_4_localization: "L10n",
  pack_5_permit: "Permit",
  pack_6_supplier: "Supplier",
  pack_7_data: "Data",
  pack_8_clinical: "Clinical",
  pack_9_treasury: "Treasury"
};

export const PACK_ENTITY_KIND: Record<PackId, EntityKind> = {
  pack_1_cfo: "invoice",
  pack_2_relocation: "move",
  pack_3_elder: "patient",
  pack_4_localization: "localization_job",
  pack_5_permit: "permit",
  pack_6_supplier: "supplier",
  pack_7_data: "etl_pipeline",
  pack_8_clinical: "clinical_submission",
  pack_9_treasury: "wallet"
};

export const PACK_PHASE_ORDER: PackId[] = [...PACK_IDS];
