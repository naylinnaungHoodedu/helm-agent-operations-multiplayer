import { describe, expect, it } from "vitest";
import packsCatalog from "@content/packs/packs.v1.json";
import cardsCatalog from "@content/cards/templates.v1.json";
import eventsCatalog from "@content/events/cinematics.v1.json";
import scenariosCatalog from "@content/scenarios/scenarios.v1.json";
import { parseGameContentBundle } from "@helm/content-schema";
import { applyDecision, createInitialWorld, tickWorld } from "@helm/sim-core";
import { detectAnomalies } from "@helm/trust-ledger";
import type { ApprovalCardV1 } from "@helm/cards";

const content = parseGameContentBundle({
  packs: packsCatalog,
  cards: cardsCatalog,
  events: eventsCatalog,
  scenarios: scenariosCatalog
});

const createBlackTreasuryCard = (): ApprovalCardV1 => ({
  id: "black_test",
  templateId: "treasury_counterparty_anomaly",
  packId: "pack_9_treasury",
  entityRef: {
    id: "wallet_1",
    kind: "wallet",
    label: "Wallet 1",
    tenantId: "tenant_1",
    packId: "pack_9_treasury",
    complianceModes: ["pci_dss"]
  },
  actionType: "approve_transfer",
  title: "Counterparty anomaly",
  summary: "Counterparty wallet was recently compromised.",
  severity: "black",
  ageHours: 0,
  agentRef: {
    agentId: "treasury_1",
    name: "treasury_v1"
  },
  confidence: 0.95,
  evidence: ["Travel rule metadata is incomplete."],
  provenance: ["counterparty_monitor.risk_scan"],
  policyReason: "Fraud heuristics disagree with the routing model.",
  allowedDecisions: ["reject", "escalate", "quarantine"],
  expectedDecision: "quarantine",
  failureEventId: "event_wallet_drain",
  tags: ["anomaly"],
  attributes: {
    counterparty_score: 21,
    oracle_variance_bps: 60,
    transfer_amount: 960000
  }
});

describe("runtime guards", () => {
  it("rejects invalid decisions and blocks policy creation on black cards", () => {
    const world = createInitialWorld({ content });
    world.queue.push(createBlackTreasuryCard());

    const result = applyDecision(world, content, {
      cardId: "black_test",
      decision: "approve",
      createPolicy: true
    });

    expect(result.snapshot.queue).toHaveLength(1);
    expect(result.snapshot.policies).toHaveLength(0);
    expect(result.delta.resolvedCards).toBe(0);
    expect(result.delta.trustDelta).toBe(0);
    expect(result.snapshot.catastrophicHistory).toHaveLength(0);
  });

  it("includes catastrophic penalties in the reported trust delta", () => {
    const world = createInitialWorld({ content });
    world.queue.push(createBlackTreasuryCard());

    const result = applyDecision(world, content, {
      cardId: "black_test",
      decision: "reject"
    });

    expect(result.snapshot.catastrophicHistory.map((event) => event.title)).toContain("Wallet drain");
    expect(result.delta.trustDelta).toBe(-45.25);
    expect(result.snapshot.lastTrustDelta).toBe(-45.25);
    expect(result.snapshot.trust).toBe(46.75);
  });

  it("does not attribute player mistakes to agent drift", () => {
    const anomalies = detectAnomalies(
      [
        {
          id: "1",
          totalHours: 10,
          packId: "pack_1_cfo",
          actionType: "send_invoice",
          entityId: "e1",
          agentId: "cfo_1",
          source: "player",
          attributedToAgent: false,
          decision: "reject",
          success: false,
          trustDelta: -0.25,
          notes: "agent:cfo_1"
        },
        {
          id: "2",
          totalHours: 11,
          packId: "pack_1_cfo",
          actionType: "send_invoice",
          entityId: "e2",
          agentId: "cfo_1",
          source: "player",
          attributedToAgent: false,
          decision: "reject",
          success: false,
          trustDelta: -0.25,
          notes: "agent:cfo_1"
        }
      ],
      0,
      new Set(),
      { cfo_1: { packId: "pack_1_cfo", reliability: 0.95 } }
    );

    expect(anomalies).toHaveLength(0);
  });

  it("can raise a new anomaly after an earlier one was resolved", () => {
    let world = createInitialWorld({ content });
    world = {
      ...world,
      anomalies: [
        {
          id: "old_anomaly",
          totalHours: 1,
          packId: "pack_1_cfo",
          severity: "red",
          agentId: "cfo_1",
          title: "old anomaly",
          reason: "resolved",
          resolved: true
        }
      ],
      ledger: [
        {
          id: "1",
          totalHours: 1,
          packId: "pack_1_cfo",
          actionType: "send_invoice",
          entityId: "e1",
          agentId: "cfo_1",
          source: "auto",
          attributedToAgent: true,
          decision: "auto_approve",
          success: false,
          trustDelta: -0.25,
          notes: "agent:cfo_1"
        },
        {
          id: "2",
          totalHours: 2,
          packId: "pack_1_cfo",
          actionType: "send_invoice",
          entityId: "e2",
          agentId: "cfo_1",
          source: "auto",
          attributedToAgent: true,
          decision: "auto_approve",
          success: false,
          trustDelta: -0.25,
          notes: "agent:cfo_1"
        }
      ]
    };

    const result = tickWorld(world, content);

    expect(result.snapshot.anomalies.filter((anomaly) => anomaly.agentId === "cfo_1" && !anomaly.resolved).length).toBe(1);
  });
});
