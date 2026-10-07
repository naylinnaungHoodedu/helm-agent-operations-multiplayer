import type { ApprovalCardV1, CardDecision } from "@helm/cards";
import { PACK_SHORT_NAMES } from "@helm/entity-graph";

interface QueueCardProps {
  card: ApprovalCardV1;
  selected: boolean;
  presenceName?: string;
  onSelect: (cardId: string) => void;
  onDecision: (cardId: string, decision: Exclude<CardDecision, "ack">, createPolicy?: boolean) => void;
}

const DECISION_ORDER: Array<Exclude<CardDecision, "ack">> = ["approve", "edit", "reject", "escalate", "quarantine"];
const HOTKEYS: Partial<Record<CardDecision, string>> = { approve: "1", edit: "2", escalate: "3", quarantine: "4", reject: "4" };

const DECISION_LABELS: Partial<Record<string, string>> = {
  approve: "Approve",
  edit: "Edit",
  reject: "Reject",
  escalate: "Escalate",
  quarantine: "Quarantine",
};

const confClass = (confidence: number) => {
  if (confidence >= 0.9) return "conf--high";
  if (confidence >= 0.7) return "conf--ok";
  if (confidence >= 0.4) return "conf--warn";
  return "conf--low";
};

export const QueueCard = ({ card, selected, presenceName, onSelect, onDecision }: QueueCardProps) => {
  const canCreatePolicy =
    card.allowedDecisions.includes("approve") && (card.severity === "yellow" || card.severity === "orange");

  return (
    <article
      className={`queue-card queue-card--${card.severity} ${selected ? "queue-card--selected" : ""}`}
      onClick={() => onSelect(card.id)}
      aria-label={`Approval card: ${card.title}, severity ${card.severity}`}
    >
      {presenceName && (
        <div className="presence-indicator" aria-label={`${presenceName} is reviewing this card`}>
          👁 {presenceName}
        </div>
      )}

      <header className="queue-card__header">
        <div>
          <span className="queue-card__pack">{PACK_SHORT_NAMES[card.packId]}</span>
          <h3>{card.title}</h3>
        </div>
        <div className="queue-card__meta">
          <span title="Card age">{card.ageHours}h</span>
          <span
            className={`queue-card__conf ${confClass(card.confidence)}`}
            title={`Agent confidence: ${Math.round(card.confidence * 100)}%`}
          >
            {Math.round(card.confidence * 100)}%
          </span>
        </div>
      </header>

      <p className="queue-card__summary">{card.summary}</p>

      <dl className="queue-card__facts">
        <div>
          <dt>Entity</dt>
          <dd>{card.entityRef.label}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{card.agentRef.name}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>{card.policyReason}</dd>
        </div>
      </dl>

      <ul className="queue-card__evidence">
        {card.evidence.slice(0, 2).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="queue-card__actions">
        {DECISION_ORDER.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={!card.allowedDecisions.includes(decision)}
            aria-label={`${DECISION_LABELS[decision] ?? decision} card ${card.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDecision(card.id, decision);
            }}
          >
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textTransform: "capitalize" }}>
              {decision}
              {HOTKEYS[decision] && <kbd className="hotkey-badge">{HOTKEYS[decision]}</kbd>}
            </span>
          </button>
        ))}
        {canCreatePolicy ? (
          <button
            type="button"
            className="queue-card__policy"
            aria-label={`Create auto-approve policy for ${card.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDecision(card.id, "approve", true);
            }}
          >
            ✦ Always approve
          </button>
        ) : null}
      </div>
    </article>
  );
};
