import { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef, startTransition } from "react";
import { PUBLIC_DEMO_SCENARIO_ID, type WorldSnapshot } from "@helm/sim-core";
import { WarRoom3D } from "./components/WarRoom3D";
import { PACK_IDS, PACK_SHORT_NAMES, type PackId } from "@helm/entity-graph";
import type { CatastrophicEventResultV1 } from "@helm/events";
import { type ScenarioId } from "@helm/content-schema";
import { QueueCard } from "./components/QueueCard";
import { TrustGauge } from "./components/TrustGauge";
import type { ScreenId } from "./game/protocol";

// Import UI components & helpers from the original App
import {
  ScreenContent,
  buildToastsFromDelta,
  summarizeDelta,
  freezeHoursRemaining,
  accuracyForPack,
  currency,
  packById,
  scenarioById,
  SPEEDS,
  type HudToast
} from "./SinglePlayerApp";

// Assume we've passed down the socket context
import { useMultiplayerSocket } from "./hooks/useMultiplayerSocket";
import { audio } from "./audio";


const SCREEN_HOTKEYS: Record<string, ScreenId> = {
  F1: "control",
  F2: "trends",
  F3: "entity",
  F4: "policy",
  F5: "org",
  F6: "capital",
  F7: "market",
  F8: "compliance",
};

const SCREEN_TABS: ScreenId[] = ["control", "trends", "entity", "policy", "org", "capital", "market", "compliance", "packs"];
const SCREEN_LABELS: Record<ScreenId, string> = {
  control: "Control",
  trends: "Trends",
  entity: "Entity",
  policy: "Policy",
  org: "Org",
  capital: "Capital",
  market: "Market",
  compliance: "Compliance",
  packs: "Packs"
};

const resolveScenarioIdFromLocation = (): ScenarioId => {
  if (typeof window === "undefined") return PUBLIC_DEMO_SCENARIO_ID;
  const candidate = new URLSearchParams(window.location.search).get("scenario");
  return candidate === "standard" || candidate === "public-demo" ? candidate : PUBLIC_DEMO_SCENARIO_ID;
};

export function MultiplayerGame({ socket }: { socket: ReturnType<typeof useMultiplayerSocket> }) {
  const scenarioId = useMemo(resolveScenarioIdFromLocation, []);
  const scenario = scenarioById[scenarioId];
  const phaserHostRef = useRef<HTMLDivElement | null>(null);

  const [toasts, setToasts] = useState<HudToast[]>([]);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [catastropheModal, setCatastropheModal] = useState<CatastrophicEventResultV1 | null>(null);
  const [activityLine, setActivityLine] = useState("Connected to HELM Server.");
  const lastCatastropheKeyRef = useRef<string | null>(null);

  const [screen, setScreen] = useState<ScreenId>("control");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<PackId>("pack_1_cfo");

  const world = socket.state.world;

  // Track previous tick to generate delta notifications manually
  const prevWorldRef = useRef<WorldSnapshot | null>(null);

  useEffect(() => {
    if (!world) return;

    if (!prevWorldRef.current && world.tickCount === 0) {
      setBriefingOpen(true);
    }

    if (prevWorldRef.current && world.tickCount > prevWorldRef.current.tickCount) {
      // Very basic manual delta approximation since the server sends the full replaced queue
      const newSpawned = world.queue.length - prevWorldRef.current.queue.length;
      const delta = {
        spawnedCards: Math.max(0, newSpawned),
        resolvedCards: Math.max(0, -newSpawned), // Overly simple, but ok for toast tracking
        triggeredEvents: [],
        trustDelta: world.trust - prevWorldRef.current.trust,
        queueDepth: world.queue.length,
        notifications: [] as any[]
      } as any;

      if (delta.spawnedCards > 0 || delta.resolvedCards > 0 || Math.abs(delta.trustDelta) > 0.01) {
        const toastBatch = buildToastsFromDelta(delta);
        if (toastBatch.length > 0) {
          setToasts((current) => [...current, ...toastBatch].slice(-6));
        }

        if (delta.trustDelta < -5 || delta.notifications.some((n: any) => n.kind === "catastrophe")) {
          audio.init();
          audio.playAlarm();
        } else if (delta.notifications.some((n: any) => n.kind === "milestone")) {
          audio.init();
          audio.playMilestone();
        }

        setActivityLine(summarizeDelta(delta, world, scenario));
      }

      const latestCatastrophe = world.catastrophicHistory[world.catastrophicHistory.length - 1];
      const latestKey = latestCatastrophe ? `${latestCatastrophe.id}:${latestCatastrophe.triggeredAtHour}` : null;
      if (latestKey && latestKey !== lastCatastropheKeyRef.current) {
        lastCatastropheKeyRef.current = latestKey;
        setCatastropheModal(latestCatastrophe);
      }
    }

    prevWorldRef.current = world;
  }, [world, scenario]);

  useEffect(() => {
    let disposed = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;
    const mount = async () => {
      const host = phaserHostRef.current;
      if (!host) return;
      const { createPhaserGame } = await import("./game/createPhaserGame");
      if (disposed || !phaserHostRef.current) return;
      game = createPhaserGame(phaserHostRef.current);
    };
    void mount();
    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, []);

  useEffect(() => {
    const cleanupTimer = window.setInterval(() => {
      setToasts((current) => current.filter((toast) => toast.expiresAt > Date.now()));
    }, 1000);
    return () => window.clearInterval(cleanupTimer);
  }, []);



  
  

    if (!world) {
    return <main className="boot-screen"><h1>Loading Simulation...</h1></main>;
  }

  const deferredQueue = useDeferredValue(world.queue);
  const selectedCard = deferredQueue.find((card) => card.id === selectedCardId) ?? deferredQueue[0] ?? null;

  const summary = {
    entities: world.customers.length + world.queue.length,
    activeAgents: world.agents.filter((agent) => agent.status === "active").length,
    idleAgents: world.agents.filter((agent) => agent.status === "idle").length,
    quarantinedAgents: world.agents.filter((agent) => agent.status === "quarantined").length,
    frozenPacks: PACK_IDS.filter((packId) => freezeHoursRemaining(world.packs[packId], world.clock.totalHours) > 0).length
  };

  const nextMilestone = scenario.grantMilestones.find((milestone) => !world.grantedMilestones.includes(milestone.id)) ?? null;

  const handleDecision = useCallback((cardId: string, decision: string, createPolicy = false) => {
    audio.init();
    if (decision === "approve") audio.playApprove();
    else if (decision === "escalate" || decision === "edit") audio.playEscalate();
    else if (decision === "quarantine" || decision === "reject") audio.playQuarantine();
    
    // Optimistic UI could be implemented here by immediately removing the card, but server responds < 50ms anyway
    void socket.makeDecision(cardId, decision, createPolicy);
  }, [socket]);

  const selectedPack = packById[selectedPackId];
  const selectedPackState = world.packs[selectedPackId];
  const selectedPackFreezeHours = freezeHoursRemaining(selectedPackState, world.clock.totalHours);

  // Focus effect for presence indicator
  
  


  


  const prevAlarmsLength = useRef(world?.alarms.length || 0);
  useEffect(() => {
    if (world && world.alarms.length > prevAlarmsLength.current) {
      audio.init();
      audio.playAlarm();
    }
    prevAlarmsLength.current = world?.alarms.length || 0;
  }, [world?.alarms.length]);

  // Ultimate Keyboard UX
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const screenMap: Record<string, ScreenId> = { F1: 'control', F2: 'trends', F3: 'entity', F4: 'policy', F5: 'org', F6: 'capital', F7: 'market', F8: 'compliance' };
      const screen = screenMap[event.key];
      if (screen) {
        event.preventDefault();
        setScreen(screen);
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        socket.setPaused(!world?.paused);
        return;
      }

      if (selectedCard) {
        const allowed = selectedCard.allowedDecisions;
        let decision: string | null = null;
        if (event.key === '1' && allowed.includes('approve')) decision = 'approve';
        else if (event.key === '2' && allowed.includes('edit')) decision = 'edit';
        else if (event.key === '3' && allowed.includes('escalate')) decision = 'escalate';
        else if (event.key === '4' && allowed.includes('quarantine')) decision = 'quarantine';
        else if (event.key === '4' && allowed.includes('reject')) decision = 'reject';

        if (decision) {
          event.preventDefault();
          handleDecision(selectedCard.id, decision);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCard, world?.paused, socket.setPaused, handleDecision]);

const handleCardFocus = (id: string | null) => {
    setSelectedCardId(id);
    socket.focusCard(id);
  };

  const myPacks = new Set(socket.state.myPackIds);

  return (
    <>
      <WarRoom3D world={world} />
      <main className="app-shell">
      <div className="phaser-layer" ref={phaserHostRef} />
      <div className="hud-layer">
        <header className="top-bar panel">
          <div className="top-bar__intro">
            <span className="eyebrow">HELM MULTIPLAYER</span>
            <strong>{scenario.name} • Room {socket.state.lobby?.code}</strong>
            <span className="top-bar__subline">{world.clock.label} • {socket.state.lobby?.players.length} Operators</span>
          </div>
          <div className="top-bar__metrics">
            <span className="metric metric--arr">
              ARR <strong>{currency(world.arr)}</strong>
            </span>
            <span className={`metric ${world.trust >= 75 ? "metric--trust-good" : world.trust >= 50 ? "metric--trust-warn" : "metric--trust-crit"}`}>
              Trust <strong>{world.trust.toFixed(2)}</strong>
            </span>
            <span className="metric metric--cash">
              Cash <strong>{currency(world.cash)}</strong>
            </span>
            <span className="metric metric--valuation">
              Val <strong>{currency(world.valuation)}</strong>
            </span>
          </div>
        </header>

        <div className="activity-strip panel">
          <span className="activity-strip__label">Control room pulse</span>
          <strong>{activityLine}</strong>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span
              className={`activity-strip__queue-badge ${
                deferredQueue.length >= 20
                  ? "activity-strip__queue-badge--crit"
                  : deferredQueue.length >= 10
                    ? "activity-strip__queue-badge--warn"
                    : "activity-strip__queue-badge--normal"
              }`}
            >
              ▣ {deferredQueue.length} pending
            </span>
            <span style={{ color: "var(--color-text-secondary)", fontSize: "0.88rem" }}>
              {nextMilestone
                ? `Next grant in ${Math.max(0, nextMilestone.triggerHour - world.clock.totalHours)}h`
                : "✓ All milestones claimed"}
            </span>
          </div>
        </div>

        <section className="layout-grid">
          <aside className="left-rail panel">
            <div className="left-rail__header">
              <div>
                <h2>Skill Packs</h2>
                <span>Packs assigned to you have a cyan border.</span>
              </div>
            </div>

            <ul className="pack-list">
              {PACK_IDS.map((packId) => {
                const pack = packById[packId];
                const packState = world.packs[packId];
                const freezeHours = freezeHoursRemaining(packState, world.clock.totalHours);
                const accuracy = accuracyForPack(packState);
                const isSelected = selectedPackId === packId;
                const isMine = myPacks.has(packId);

                return (
                  <li
                    key={packId}
                    className={[
                      packState.unlocked ? "is-active" : "",
                      freezeHours > 0 ? "is-frozen" : "",
                      isSelected ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={isMine ? { borderLeft: "4px solid var(--color-cyan)" } : undefined}
                  >
                    <button type="button" className="pack-list__entry" onClick={() => { setSelectedPackId(packId); setScreen("packs"); }}>
                      <div className="pack-list__title">
                        <strong>{PACK_SHORT_NAMES[packId]} {isMine ? "(Yours)" : ""}</strong>
                        <span>{pack.name}</span>
                      </div>
                      <div className="pack-list__status">
                        <span className={`status-chip ${freezeHours > 0 ? "status-chip--warning" : packState.unlocked ? "status-chip--success" : ""}`}>
                          {freezeHours > 0 ? `Frozen ${freezeHours}h` : packState.unlocked ? "Unlocked" : currency(packState.unlockCost)}
                        </span>
                        <span>Phase {pack.phase}</span>
                      </div>
                    </button>
                    {!packState.unlocked ? (
                      <button type="button" disabled={!isMine} onClick={() => socket.unlockPack(packId)}>
                        Unlock
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="center-stage panel">
            <div className="panel-toolbar">
              <div className="screen-tabs">
                {SCREEN_TABS.map((tab, index) => {
                  const hotkey = index < 8 ? `F${index + 1}` : null;
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={screen === tab ? "is-active" : ""}
                      onClick={() => setScreen(tab)}
                      title={hotkey ? `${SCREEN_LABELS[tab]} [${hotkey}]` : SCREEN_LABELS[tab]}
                    >
                      {SCREEN_LABELS[tab]}
                      {hotkey && <kbd className="hotkey-badge">{hotkey}</kbd>}
                    </button>
                  );
                })}
              </div>

              <div className="runtime-controls">
                <button type="button" disabled={!socket.state.isHost} onClick={() => socket.setPaused(!world?.paused)}>
                  {world?.paused ? "Run [Space]" : "Pause [Space]"}
                </button>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    disabled={!socket.state.isHost}
                    className={world.speed === speed ? "is-active" : ""}
                    onClick={() => socket.setSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {screen === "control" ? (
              <div className="queue-view">
                <div className="queue-summary">
                  <div>
                    <strong>{deferredQueue.length} cards pending</strong>
                    <span>Server Auth | Unlock floor: {scenario.unlockTrustFloor} trust</span>
                  </div>
                </div>

                <div className="queue-list">
                  {deferredQueue.map((card) => {
                    const presence = Object.values(socket.state.presence).find(p => p.focusedCardId === card.id);
                    return (
                      <QueueCard
                        key={card.id}
                        card={card}
                        selected={selectedCard?.id === card.id}
                        presenceName={presence?.playerName}
                        onSelect={(id) => handleCardFocus(id)}
                        onDecision={handleDecision}
                      />
                    );
                  })}
                  {!deferredQueue.length && (
                    <p className="empty-state">Queue is clear.</p>
                  )}
                </div>
              </div>
            ) : (
              <ScreenContent
                screen={screen}
                world={world}
                scenario={scenario}
                selectedCard={selectedCard}
                selectedPackId={selectedPackId}
                onSelectPack={(pid) => { setSelectedPackId(pid); setScreen("packs"); }}
              />
            )}
          </section>

          <aside className="right-rail panel">
            <TrustGauge trust={world.trust} lastTrustDelta={world.lastTrustDelta} />
            <section className="sidebar-section">
              <h2>Operators</h2>
              <ul className="alarm-list">
                {socket.state.lobby?.players.map(p => {
                  const presenceInfo = p.id ? Object.values(socket.state.presence).find(pr => pr.playerId === p.id) : undefined;
                  const focusedCard = presenceInfo?.focusedCardId
                    ? world.queue.find(c => c.id === presenceInfo.focusedCardId)
                    : undefined;
                  return (
                    <li key={p.id} className="alarm" style={{ color: p.connected ? "var(--color-text)" : "var(--color-text-secondary)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span className={`operator-dot ${p.connected ? "operator-dot--online" : "operator-dot--offline"}`} title={p.connected ? "Online" : "Disconnected"} />
                        <strong>{p.name} {p.isHost ? "👑" : ""} {p.id === socket.state.myPlayerId ? "(You)" : ""}</strong>
                      </div>
                      {focusedCard && (
                        <span style={{ fontSize: "0.78rem", color: "var(--color-cyan)", paddingLeft: "1.2rem" }}>
                          👁 {focusedCard.title}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="sidebar-section">
              <h2>Alarms</h2>
              <ul className="alarm-list">
                {world.alarms.map((alarm) => (
                  <li key={alarm.id} className={`alarm alarm--${alarm.severity}`}>
                    <strong>{alarm.message}</strong>
                    <span>{alarm.requiredAction}</span>
                  </li>
                ))}
                {!world.alarms.length && <li className="alarm alarm--quiet">No active alarms.</li>}
              </ul>
            </section>
          </aside>
        </section>
      </div>

      <section className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <article key={toast.id} className={`toast toast--${toast.severity}`}>
            <div>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast__dismiss"
              onClick={() => setToasts((current) => current.filter((c) => c.id !== toast.id))}
            >
              Dismiss
            </button>
          </article>
        ))}
      </section>

      {briefingOpen ? (
        <div className="modal-shell">
          <section className="modal-card briefing-card">
            <div className="modal-card__header">
              <div>
                <span className="eyebrow">First-run briefing</span>
                <h2>{scenario.name}</h2>
              </div>
              <button type="button" onClick={() => setBriefingOpen(false)}>Close</button>
            </div>
            <p>{scenario.description}</p>
            <div className="modal-card__actions">
              <button type="button" onClick={() => setBriefingOpen(false)}>Close Briefing</button>
            </div>
          </section>
        </div>
      ) : null}

      {catastropheModal ? (
        <div className="modal-shell modal-shell--critical">
          <section className="modal-card catastrophe-card">
            <div className="modal-card__header">
              <div>
                <span className="eyebrow">Catastrophic event</span>
                <h2>{catastropheModal.title}</h2>
              </div>
              <button type="button" onClick={() => setCatastropheModal(null)}>Close</button>
            </div>
            <div className="catastrophe-ticker">
              {catastropheModal.scriptLines.map((line) => (<span key={line}>{line}</span>))}
            </div>
            <p>{catastropheModal.recoveryText}</p>
            <div className="modal-card__actions">
              <button type="button" className="is-primary" onClick={() => setCatastropheModal(null)}>Dismiss</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
      </>
  );
}

