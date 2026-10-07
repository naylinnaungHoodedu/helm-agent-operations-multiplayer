import type { PackId } from "@helm/entity-graph";

export interface LedgerEntryV1 {
  id: string;
  totalHours: number;
  packId: PackId;
  actionType: string;
  entityId: string;
  agentId: string | null;
  source: "auto" | "player" | "system";
  attributedToAgent: boolean;
  decision: string;
  success: boolean;
  trustDelta: number;
  notes: string;
}

export interface AnomalyRecordV1 {
  id: string;
  totalHours: number;
  packId: PackId;
  severity: "orange" | "red" | "black";
  agentId: string;
  title: string;
  reason: string;
  resolved: boolean;
}

export interface TrustBreakdownV1 {
  trustBefore: number;
  trustAfter: number;
  accuracyScore: number;
  approvalLatencyScore: number;
  overrideAppropriateness: number;
  anomalyPenalty: number;
  customerNpsScore: number;
  compliancePenalty: number;
  catastrophicPenalty: number;
  totalDelta: number;
}

export interface TrustInputs {
  currentTrust: number;
  correctActions: number;
  cleanLatency: boolean;
  backlogPenalty: number;
  correctOverrides: number;
  incorrectOverrides: number;
  unresolvedAnomalies: number;
  customerNps: number;
  complianceViolations: number;
  catastrophicPenalty: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const calculateTrustBreakdown = (input: TrustInputs): TrustBreakdownV1 => {
  const accuracyScore = input.correctActions * 0.05;
  const approvalLatencyScore = input.cleanLatency ? 0.02 : -0.04 * input.backlogPenalty;
  const overrideAppropriateness = input.correctOverrides * 0.1 - input.incorrectOverrides * 0.2;
  const anomalyPenalty = input.unresolvedAnomalies * -0.15;
  const customerNpsScore = 0.01 * input.customerNps;
  const compliancePenalty = input.complianceViolations * -2;
  const totalDelta =
    accuracyScore +
    approvalLatencyScore +
    overrideAppropriateness +
    anomalyPenalty +
    customerNpsScore +
    compliancePenalty +
    input.catastrophicPenalty;

  return {
    trustBefore: input.currentTrust,
    trustAfter: clamp(Number((input.currentTrust + totalDelta).toFixed(2)), 0, 100),
    accuracyScore,
    approvalLatencyScore,
    overrideAppropriateness,
    anomalyPenalty,
    customerNpsScore,
    compliancePenalty,
    catastrophicPenalty: input.catastrophicPenalty,
    totalDelta
  };
};

export const detectAnomalies = (
  ledger: LedgerEntryV1[],
  windowStartHour: number,
  unresolvedAgentIds: Set<string>,
  agentLookup: Record<string, { packId: PackId; reliability: number }>
): AnomalyRecordV1[] => {
  const recent = ledger.filter((entry) => entry.totalHours >= windowStartHour && entry.agentId);
  const grouped = new Map<string, LedgerEntryV1[]>();

  for (const entry of recent) {
    const agentId = entry.agentId!;
    const entries = grouped.get(agentId) ?? [];
    entries.push(entry);
    grouped.set(agentId, entries);
  }

  const anomalies: AnomalyRecordV1[] = [];
  for (const [agentId, entries] of grouped.entries()) {
    if (unresolvedAgentIds.has(agentId)) {
      continue;
    }
    const misses = entries.filter((entry) => entry.attributedToAgent && !entry.success).length;
    const agent = agentLookup[agentId];
    if (!agent) {
      continue;
    }
    if (misses >= 2 || agent.reliability < 0.72) {
      anomalies.push({
        id: `anom_${agentId}_${windowStartHour}`,
        totalHours: windowStartHour,
        packId: agent.packId,
        severity: misses >= 3 ? "black" : "red",
        agentId,
        title: `${agentId} confidence drift`,
        reason: "Repeated low-quality decisions detected in recent window.",
        resolved: false
      });
    }
  }

  return anomalies;
};
