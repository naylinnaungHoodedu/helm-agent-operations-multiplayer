import type { ApprovalCardV1, CardDecision } from "@helm/cards";
import type { PackId } from "@helm/entity-graph";

export type PolicyDecision = "auto_approve" | "escalate" | "reject" | "hold";
export type PolicyOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not_in" | "contains";

export interface PolicyConditionV1 {
  field: string;
  op: PolicyOperator;
  value: string | number | boolean | Array<string | number | boolean>;
}

export interface PolicyRuleV1 {
  id: string;
  name: string;
  packId: PackId;
  actionType: string;
  conditions: PolicyConditionV1[];
  decision: PolicyDecision;
  confidenceFloor: number;
  expiresAtHour: number | null;
  createdBy: "player" | "system";
  createdAtHour: number;
  stats: {
    totalMatches: number;
    overrideRate: number;
    trustDelta: number;
    driftWarning?: string;
  };
}

export interface PolicySuggestionV1 {
  name: string;
  packId: PackId;
  actionType: string;
  conditions: PolicyConditionV1[];
  decision: "auto_approve";
  confidenceFloor: number;
}

const compare = (
  actual: string | number | boolean | undefined,
  op: PolicyOperator,
  expected: PolicyConditionV1["value"]
) => {
  if (actual === undefined) {
    return false;
  }
  switch (op) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return Number(actual) > Number(expected);
    case ">=":
      return Number(actual) >= Number(expected);
    case "<":
      return Number(actual) < Number(expected);
    case "<=":
      return Number(actual) <= Number(expected);
    case "in":
      return Array.isArray(expected) ? expected.includes(actual) : false;
    case "not_in":
      return Array.isArray(expected) ? !expected.includes(actual) : false;
    case "contains":
      return String(actual).includes(String(expected));
  }
};

export const ruleMatches = (
  rule: PolicyRuleV1,
  packId: PackId,
  actionType: string,
  confidence: number,
  attributes: Record<string, string | number | boolean>,
  totalHours: number
) => {
  if (rule.packId !== packId || rule.actionType !== actionType) {
    return false;
  }
  if (rule.expiresAtHour !== null && totalHours > rule.expiresAtHour) {
    return false;
  }
  if (confidence < rule.confidenceFloor) {
    return false;
  }
  return rule.conditions.every((condition) => compare(attributes[condition.field], condition.op, condition.value));
};

export const matchPolicy = (
  rules: PolicyRuleV1[],
  input: {
    packId: PackId;
    actionType: string;
    confidence: number;
    attributes: Record<string, string | number | boolean>;
    totalHours: number;
  }
) => rules.find((rule) => ruleMatches(rule, input.packId, input.actionType, input.confidence, input.attributes, input.totalHours));

export const suggestPolicyFromCard = (card: ApprovalCardV1): PolicySuggestionV1 => ({
  name: `${card.title} auto-approve`,
  packId: card.packId,
  actionType: card.actionType,
  conditions: Object.entries(card.attributes)
    .slice(0, 3)
    .map(([field, value]) => ({
      field,
      op: typeof value === "number" ? "<=" : "==",
      value: typeof value === "number" ? Math.max(1, Math.round(value)) : value
    })),
  decision: "auto_approve",
  confidenceFloor: Number(card.confidence.toFixed(2))
});

export const trackPolicyDecision = (
  rule: PolicyRuleV1,
  expectedDecision: CardDecision,
  actualDecision: CardDecision
): PolicyRuleV1 => {
  const totalMatches = rule.stats.totalMatches + 1;
  const wrong = expectedDecision !== actualDecision ? 1 : 0;
  const overrideRate = (rule.stats.overrideRate * rule.stats.totalMatches + wrong) / totalMatches;
  return {
    ...rule,
    stats: {
      ...rule.stats,
      totalMatches,
      overrideRate,
      driftWarning: overrideRate > 0.05 ? "Override rate creeping up - review needed" : undefined
    }
  };
};
