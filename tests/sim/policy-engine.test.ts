import { describe, expect, it } from "vitest";
import { matchPolicy, suggestPolicyFromCard } from "@helm/policy-engine";
import type { ApprovalCardV1 } from "@helm/cards";

const sampleCard: ApprovalCardV1 = {
  id: "card_1",
  templateId: "cfo_routine_invoice",
  packId: "pack_1_cfo",
  entityRef: {
    id: "invoice_1",
    kind: "invoice",
    label: "INV-2204",
    tenantId: "tenant_1",
    packId: "pack_1_cfo",
    complianceModes: ["recordkeeping"]
  },
  actionType: "send_invoice",
  title: "Routine invoice",
  summary: "Invoice a trusted customer.",
  severity: "yellow",
  ageHours: 0,
  agentRef: {
    agentId: "cfo_1",
    name: "cfo_v1"
  },
  confidence: 0.93,
  evidence: ["paid on time", "low dispute rate"],
  provenance: ["crm.fetch_client_profile", "ledger.generate_invoice"],
  policyReason: "Below current auto-approve threshold.",
  allowedDecisions: ["approve", "edit", "reject", "escalate"],
  expectedDecision: "approve",
  failureEventId: null,
  tags: ["routine"],
  attributes: {
    client_paid_invoices: 4,
    amount: 2400,
    client_disputes: 0
  }
};

describe("policy engine", () => {
  it("suggests an auto-approval rule from a card", () => {
    const suggestion = suggestPolicyFromCard(sampleCard);
    expect(suggestion.packId).toBe("pack_1_cfo");
    expect(suggestion.conditions.length).toBeGreaterThan(0);
  });

  it("matches a rule against card attributes", () => {
    const suggestion = suggestPolicyFromCard(sampleCard);
    const rule = {
      id: "policy_1",
      ...suggestion,
      expiresAtHour: null,
      createdBy: "player" as const,
      createdAtHour: 0,
      stats: {
        totalMatches: 0,
        overrideRate: 0,
        trustDelta: 0
      }
    };

    const match = matchPolicy([rule], {
      packId: sampleCard.packId,
      actionType: sampleCard.actionType,
      confidence: sampleCard.confidence,
      attributes: sampleCard.attributes,
      totalHours: 2
    });

    expect(match?.id).toBe("policy_1");
  });
});
