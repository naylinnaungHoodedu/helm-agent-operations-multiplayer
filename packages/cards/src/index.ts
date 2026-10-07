import type { EntityRef, PackId } from "@helm/entity-graph";

export type CardSeverity = "green" | "yellow" | "orange" | "red" | "black";
export type CardDecision = "approve" | "edit" | "reject" | "escalate" | "quarantine" | "ack";

export interface ApprovalCardV1 {
  id: string;
  templateId: string;
  packId: PackId;
  entityRef: EntityRef;
  actionType: string;
  title: string;
  summary: string;
  severity: CardSeverity;
  ageHours: number;
  agentRef: {
    agentId: string;
    name: string;
  };
  confidence: number;
  evidence: string[];
  provenance: string[];
  policyReason: string;
  allowedDecisions: CardDecision[];
  expectedDecision: Exclude<CardDecision, "ack">;
  failureEventId: string | null;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
}

export interface AlarmV1 {
  id: string;
  packId: PackId;
  severity: Exclude<CardSeverity, "green">;
  source: string;
  message: string;
  expiresAtHour: number | null;
  requiredAction: string;
}

export const allowedDecisionsForSeverity = (severity: CardSeverity): CardDecision[] => {
  switch (severity) {
    case "green":
      return ["ack"];
    case "yellow":
    case "orange":
    case "red":
      return ["approve", "edit", "reject", "escalate"];
    case "black":
      return ["reject", "escalate", "quarantine"];
  }
};

export const severityWeight: Record<CardSeverity, number> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
  black: 4
};

export const sortCardsByPriority = (cards: ApprovalCardV1[]) =>
  [...cards].sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || b.ageHours - a.ageHours);
