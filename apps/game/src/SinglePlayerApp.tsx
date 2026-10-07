import {
  lazy,
  startTransition,
  Suspense,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from "react";
import { useMachine } from "@xstate/react";
import { audio } from "./audio";
import { assign, setup } from "xstate";
import type { ApprovalCardV1, CardDecision } from "@helm/cards";
import {
  parsePackCatalog,
  parseScenarioCatalog,
  type PackDefinitionV1,
  type ScenarioDefinitionV1,
  type ScenarioId
} from "@helm/content-schema";
import { PACK_IDS, PACK_SHORT_NAMES, type PackId, type PackUnlockState } from "@helm/entity-graph";
import type { CatastrophicEventResultV1 } from "@helm/events";
import {
  PUBLIC_DEMO_SCENARIO_ID,
  createSaveGame,
  type WorldDelta,
  type WorldNotification,
  type WorldSnapshot
} from "@helm/sim-core";
import packsCatalogJson from "@content/packs/packs.v1.json";
import scenariosCatalogJson from "@content/scenarios/scenarios.v1.json";
import { QueueCard } from "./components/QueueCard";
import { TrustGauge } from "./components/TrustGauge";
import { WarRoom3D } from "./components/WarRoom3D";
import type { ScreenId, WorkerEvent, WorkerRequest } from "./game/protocol";
import { loadAutosave, saveAutosave } from "./storage";

const TrendsPanel = lazy(() =>
  import("./components/TrendsPanel").then((module) => ({
    default: module.TrendsPanel
  }))
);

const packCatalog = parsePackCatalog(packsCatalogJson).packs;
const scenarioCatalog = parseScenarioCatalog(scenariosCatalogJson).scenarios;

export const packById = Object.fromEntries(packCatalog.map((pack) => [pack.id, pack])) as Record<PackId, PackDefinitionV1>;
export const scenarioById = Object.fromEntries(
  scenarioCatalog.map((scenario) => [scenario.id, scenario])
) as Record<ScenarioId, ScenarioDefinitionV1>;

export const SPEEDS: Array<1 | 2 | 4> = [1, 2, 4];
const TOAST_TTL_MS = 6000;
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

export type HudToast = WorldNotification & {
  expiresAt: number;
};

type SessionContext = {
  world: WorldSnapshot | null;
  screen: ScreenId;
  selectedCardId: string | null;
  selectedPackId: PackId;
  autosaveState: string;
  error: string | null;
};

type SessionEvent =
  | { type: "READY"; world: WorldSnapshot }
  | { type: "SET_WORLD"; world: WorldSnapshot }
  | { type: "OPEN_SCREEN"; screen: ScreenId }
  | { type: "SELECT_CARD"; cardId: string | null }
  | { type: "SELECT_PACK"; packId: PackId }
  | { type: "AUTOSAVE"; status: string }
  | { type: "FAIL"; message: string };

const resolvePackSelection = (world: WorldSnapshot, current: PackId | null): PackId =>
  current ?? PACK_IDS.find((packId) => world.packs[packId].unlocked) ?? PACK_IDS[0];

const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent
  }
}).createMachine({
  id: "helm-session",
  initial: "booting",
  context: {
    world: null,
    screen: "control",
    selectedCardId: null,
    selectedPackId: "pack_1_cfo",
    autosaveState: "Loading",
    error: null
  },
  states: {
    booting: {
      on: {
        READY: {
          target: "ready",
          actions: assign(({ context, event }) => ({
            world: event.world,
            selectedCardId: event.world.queue[0]?.id ?? null,
            selectedPackId: resolvePackSelection(event.world, context.selectedPackId),
            error: null
          }))
        },
        AUTOSAVE: {
          actions: assign(({ event }) => ({
            autosaveState: event.status
          }))
        },
        FAIL: {
          target: "error",
          actions: assign(({ event }) => ({
            error: event.message
          }))
        }
      }
    },
    ready: {
      on: {
        SET_WORLD: {
          actions: assign(({ context, event }) => ({
            world: event.world,
            selectedCardId:
              event.world.queue.find((card) => card.id === context.selectedCardId)?.id ??
              event.world.queue[0]?.id ??
              null,
            selectedPackId: resolvePackSelection(event.world, context.selectedPackId)
          }))
        },
        OPEN_SCREEN: {
          actions: assign(({ event }) => ({
            screen: event.screen
          }))
        },
        SELECT_CARD: {
          actions: assign(({ event }) => ({
            selectedCardId: event.cardId
          }))
        },
        SELECT_PACK: {
          actions: assign(({ event }) => ({
            selectedPackId: event.packId
          }))
        },
        AUTOSAVE: {
          actions: assign(({ event }) => ({
            autosaveState: event.status
          }))
        },
        FAIL: {
          target: "error",
          actions: assign(({ event }) => ({
            error: event.message
          }))
        }
      }
    },
    error: {}
  }
});

const screenFromHotkey: Record<string, ScreenId> = {
  F1: "control",
  F2: "trends",
  F3: "entity",
  F4: "policy",
  F5: "org",
  F6: "capital",
  F7: "market",
  F8: "compliance"
};

export const currency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export const freezeHoursRemaining = (pack: PackUnlockState, totalHours: number) =>
  pack.freezeUntilHour === null ? 0 : Math.max(0, pack.freezeUntilHour - totalHours);

export const accuracyForPack = (pack: PackUnlockState) =>
  pack.resolvedCards > 0 ? Math.round((pack.correctDecisions / pack.resolvedCards) * 100) : null;

const resolveScenarioIdFromLocation = (): ScenarioId => {
  if (typeof window === "undefined") {
    return PUBLIC_DEMO_SCENARIO_ID;
  }
  const candidate = new URLSearchParams(window.location.search).get("scenario");
  return candidate === "standard" || candidate === "public-demo" ? candidate : PUBLIC_DEMO_SCENARIO_ID;
};

const createToast = (partial: Omit<HudToast, "expiresAt">): HudToast => ({
  ...partial,
  expiresAt: Date.now() + TOAST_TTL_MS
});

export const buildToastsFromDelta = (delta: WorldDelta): HudToast[] => {
  const notifications = delta.notifications.map((notification) => createToast(notification));
  const summaryToasts: HudToast[] = [];

  if (delta.spawnedCards > 0) {
    summaryToasts.push(
      createToast({
        id: `spawn_${Date.now()}_${delta.queueDepth}`,
        kind: "system",
        severity: "info",
        title: delta.spawnedCards === 1 ? "New approval card" : `${delta.spawnedCards} new approval cards`,
        message: `Queue depth is now ${delta.queueDepth}.`
      })
    );
  }

  if (delta.resolvedCards > 0) {
    summaryToasts.push(
      createToast({
        id: `resolve_${Date.now()}_${delta.resolvedCards}`,
        kind: "system",
        severity: "success",
        title: delta.resolvedCards === 1 ? "Card resolved" : `${delta.resolvedCards} cards resolved`,
        message: `Queue depth is now ${delta.queueDepth}.`
      })
    );
  }

  if (delta.trustDelta !== 0) {
    const severity = delta.trustDelta > 0 ? "success" : Math.abs(delta.trustDelta) >= 5 ? "critical" : "warning";
    summaryToasts.push(
      createToast({
        id: `trust_${Date.now()}_${delta.trustDelta}`,
        kind: "system",
        severity,
        title: `Trust ${delta.trustDelta > 0 ? "up" : "down"} ${delta.trustDelta.toFixed(2)}`,
        message: "Operator trust moved to reflect the latest approvals and incidents."
      })
    );
  }

  return [...notifications, ...summaryToasts].slice(-6);
};

export const summarizeDelta = (delta: WorldDelta, world: WorldSnapshot, scenario: ScenarioDefinitionV1) => {
  const latestNotification = delta.notifications[delta.notifications.length - 1];
  if (latestNotification) {
    return latestNotification.message;
  }

  const fragments: string[] = [];
  if (delta.spawnedCards > 0) {
    fragments.push(`${delta.spawnedCards} new card${delta.spawnedCards === 1 ? "" : "s"}`);
  }
  if (delta.resolvedCards > 0) {
    fragments.push(`${delta.resolvedCards} resolved`);
  }
  if (delta.trustDelta !== 0) {
    fragments.push(`trust ${delta.trustDelta > 0 ? "+" : ""}${delta.trustDelta.toFixed(2)}`);
  }

  if (!fragments.length) {
    return `${scenario.name} monitoring ${PACK_IDS.filter((packId) => world.packs[packId].unlocked).length} live packs.`;
  }

  return fragments.join(" | ");
};

export default function App() {
  const scenarioId = useMemo(resolveScenarioIdFromLocation, []);
  const scenario = scenarioById[scenarioId];
  const phaserHostRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastCatastropheKeyRef = useRef<string | null>(null);
  const [state, send] = useMachine(sessionMachine);
  const [toasts, setToasts] = useState<HudToast[]>([]);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [catastropheModal, setCatastropheModal] = useState<CatastrophicEventResultV1 | null>(null);
  const [activityLine, setActivityLine] = useState("Booting control room runtime.");

  const postRequest = (request: WorkerRequest) => workerRef.current?.postMessage(request);

  const openPackScreen = (packId: PackId, screen: ScreenId = "packs") => {
    send({ type: "SELECT_PACK", packId });
    send({ type: "OPEN_SCREEN", screen });
  };

  const handleWorkerMessage = useEffectEvent((event: MessageEvent<WorkerEvent>) => {
    const message = event.data;

    switch (message.type) {
      case "error":
        send({ type: "FAIL", message: message.message });
        return;
      case "ready": {
        const latestCatastrophe = message.snapshot.catastrophicHistory[message.snapshot.catastrophicHistory.length - 1];
        lastCatastropheKeyRef.current = latestCatastrophe
          ? `${latestCatastrophe.id}:${latestCatastrophe.triggeredAtHour}`
          : null;

        startTransition(() => {
          send({ type: "READY", world: message.snapshot });
        });

        setBriefingOpen(message.snapshot.tickCount === 0 && message.snapshot.paused);
        setCatastropheModal(null);
        setActivityLine(
          message.snapshot.tickCount === 0
            ? `${scenario.name} ready. Review the briefing, then start the staged demo run.`
            : `Resumed ${scenario.name} at ${message.snapshot.clock.label}.`
        );
        return;
      }
      case "snapshot": {
        startTransition(() => {
          send({ type: "SET_WORLD", world: message.snapshot });
        });

        const toastBatch = buildToastsFromDelta(message.delta);
        if (toastBatch.length > 0) {
          setToasts((current) => [...current, ...toastBatch].slice(-6));
        }

        if (message.delta.trustDelta < -5 || message.delta.notifications.some(n => n.kind === "catastrophe")) {
          audio.init();
          audio.playAlarm();
        } else if (message.delta.notifications.some(n => n.kind === "milestone")) {
          audio.init();
          audio.playMilestone();
        }

        setActivityLine(summarizeDelta(message.delta, message.snapshot, scenario));

        const latestCatastrophe = message.snapshot.catastrophicHistory[message.snapshot.catastrophicHistory.length - 1];
        const latestKey = latestCatastrophe ? `${latestCatastrophe.id}:${latestCatastrophe.triggeredAtHour}` : null;
        if (latestKey && latestKey !== lastCatastropheKeyRef.current) {
          lastCatastropheKeyRef.current = latestKey;
          setCatastropheModal(latestCatastrophe);
        }

        if (message.savePoint) {
          send({ type: "AUTOSAVE", status: "Saving" });
          void saveAutosave(createSaveGame(message.snapshot))
            .then(() => send({ type: "AUTOSAVE", status: "Saved" }))
            .catch((error: unknown) =>
              send({
                type: "AUTOSAVE",
                status: error instanceof Error ? `Save failed: ${error.message}` : "Save failed"
              })
            );
        }
        return;
      }
    }
  });

  useEffect(() => {
    const worker = new Worker(new URL("./workers/sim.worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    const onMessage = (event: MessageEvent<WorkerEvent>) => handleWorkerMessage(event);
    worker.addEventListener("message", onMessage);

    void loadAutosave(scenarioId)
      .then((saveGame) => {
        send({ type: "AUTOSAVE", status: saveGame ? "Loaded" : "Fresh run" });
        const request: WorkerRequest = { type: "init", scenarioId, saveGame };
        worker.postMessage(request);
      })
      .catch((error: unknown) => {
        send({
          type: "FAIL",
          message: error instanceof Error ? error.message : "Unable to load save."
        });
      });

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, [handleWorkerMessage, scenarioId, send]);

  useEffect(() => {
    let disposed = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;

    const mount = async () => {
      const host = phaserHostRef.current;
      if (!host) {
        return;
      }

      const { createPhaserGame } = await import("./game/createPhaserGame");
      if (disposed || !phaserHostRef.current) {
        return;
      }
      game = createPhaserGame(phaserHostRef.current);
    };

    void mount();

    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const screen = screenFromHotkey[event.key];
      if (!screen) {
        return;
      }
      event.preventDefault();
      send({ type: "OPEN_SCREEN", screen });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

  useEffect(() => {
    const cleanupTimer = window.setInterval(() => {
      setToasts((current) => current.filter((toast) => toast.expiresAt > Date.now()));
    }, 1000);

    return () => window.clearInterval(cleanupTimer);
  }, []);

  const world = state.context.world;

  const prevAlarmsLength = useRef(world?.alarms.length || 0);
  useEffect(() => {
    if (world && world.alarms.length > prevAlarmsLength.current) {
      audio.init();
      audio.playAlarm();
    }
    prevAlarmsLength.current = world?.alarms.length || 0;
  }, [world?.alarms.length]);
  const deferredQueue = useDeferredValue(world?.queue ?? []);
  const selectedCard =
    deferredQueue.find((card) => card.id === state.context.selectedCardId) ?? deferredQueue[0] ?? null;

  const summary = useMemo(() => {
    if (!world) {
      return null;
    }

    return {
      entities: world.customers.length + world.queue.length,
      activeAgents: world.agents.filter((agent) => agent.status === "active").length,
      idleAgents: world.agents.filter((agent) => agent.status === "idle").length,
      quarantinedAgents: world.agents.filter((agent) => agent.status === "quarantined").length,
      frozenPacks: PACK_IDS.filter((packId) => freezeHoursRemaining(world.packs[packId], world.clock.totalHours) > 0).length
    };
  }, [world]);

  const nextMilestone = useMemo(() => {
    if (!world) {
      return null;
    }
    return scenario.grantMilestones.find((milestone) => !world.grantedMilestones.includes(milestone.id)) ?? null;
  }, [scenario, world]);

  const canUnlockLocally = (packId: PackId) => {
    if (!world) {
      return false;
    }
    const currentIndex = PACK_IDS.indexOf(packId);
    const previousUnlocked = currentIndex <= 0 ? true : world.packs[PACK_IDS[currentIndex - 1]].unlocked;
    return previousUnlocked && world.cash >= world.packs[packId].unlockCost && world.trust >= scenario.unlockTrustFloor;
  };

  const handleDecision = (cardId: string, decision: Exclude<CardDecision, "ack">, createPolicy = false) => {
    // Play sensory feedback
    audio.init();
    if (decision === "approve") audio.playApprove();
    else if (decision === "escalate") audio.playEscalate();
    else if (decision === "quarantine") audio.playQuarantine();

    postRequest({
      type: "decision",
      payload: {
        cardId,
        decision,
        createPolicy
      }
    });
  };

  const selectedPack = world ? packById[state.context.selectedPackId] : null;
  const selectedPackState = world ? world.packs[state.context.selectedPackId] : null;

  if (state.matches("booting") || !world || !summary || !selectedPack || !selectedPackState) {
    return (
      <main className="boot-screen">
        <div className="boot-logo">
          <div className="boot-logo__sigil" aria-hidden="true">⬡</div>
          <h1>HELM Agent Operations</h1>
          <p className="loading-pulse" aria-live="polite">{scenario.name}</p>
        </div>
      </main>
    );
  }

  if (state.matches("error")) {
    return (
      <main className="boot-screen">
        <div className="boot-logo">
          <div className="boot-logo__sigil" style={{ borderColor: "var(--color-red)" }} aria-hidden="true">⚠</div>
          <h1>Boot failure</h1>
          <p style={{ color: "var(--color-red)" }}>{state.context.error}</p>
        </div>
      </main>
    );
  }

  const selectedPackFreezeHours = freezeHoursRemaining(selectedPackState, world.clock.totalHours);

  return (
    <main className="app-shell">
      <WarRoom3D world={world} />
      <div className="phaser-layer" ref={phaserHostRef} />

      <div className="hud-layer">
        <header className="top-bar panel">
          <div className="top-bar__intro">
            <span className="eyebrow">HELM</span>
            <strong>{scenario.name}</strong>
            <span className="top-bar__subline">{world.clock.label}</span>
          </div>
          <div className="top-bar__metrics">
            <span className={`metric metric--arr`}>
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
              title="Cards currently pending in queue"
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
                <span>All nine packs stay visible during the demo.</span>
              </div>
              <button type="button" onClick={() => send({ type: "OPEN_SCREEN", screen: "packs" })}>
                Roadmap
              </button>
            </div>

            <ul className="pack-list">
              {PACK_IDS.map((packId) => {
                const pack = packById[packId];
                const packState = world.packs[packId];
                const freezeHours = freezeHoursRemaining(packState, world.clock.totalHours);
                const accuracy = accuracyForPack(packState);
                const isSelected = state.context.selectedPackId === packId;

                return (
                  <li
                    key={packId}
                    className={[
                      packState.unlocked ? "is-active" : "",
                      freezeHours > 0 ? "is-frozen" : "",
                      isSelected ? "is-selected" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button type="button" className="pack-list__entry" onClick={() => openPackScreen(packId)}>
                      <div className="pack-list__title">
                        <strong>{PACK_SHORT_NAMES[packId]}</strong>
                        <span>{pack.name}</span>
                      </div>
                      <div className="pack-list__status">
                        <span
                          className={`status-chip ${freezeHours > 0 ? "status-chip--warning" : packState.unlocked ? "status-chip--success" : ""}`}
                        >
                          {freezeHours > 0 ? `Frozen ${freezeHours}h` : packState.unlocked ? "Unlocked" : currency(packState.unlockCost)}
                        </span>
                        <span>Phase {pack.phase}</span>
                      </div>
                      <div className="pack-list__meta">
                        <span>{packState.activeCustomers} customers</span>
                        <span>Queue {packState.queuePressure}</span>
                        <span>{accuracy === null ? "No decisions yet" : `${accuracy}% correct`}</span>
                        <span>{packState.policiesCreated} policies</span>
                      </div>
                    </button>

                    {!packState.unlocked ? (
                      <button
                        type="button"
                        disabled={!canUnlockLocally(packId)}
                        onClick={() => postRequest({ type: "unlockPack", packId })}
                      >
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
                {SCREEN_TABS.map((screen, index) => {
                  const hotkey = index < 8 ? `F${index + 1}` : null;
                  return (
                    <button
                      key={screen}
                      type="button"
                      className={state.context.screen === screen ? "is-active" : ""}
                      onClick={() => send({ type: "OPEN_SCREEN", screen })}
                      title={hotkey ? `${SCREEN_LABELS[screen]} [${hotkey}]` : SCREEN_LABELS[screen]}
                    >
                      {SCREEN_LABELS[screen]}
                      {hotkey && <kbd className="hotkey-badge">{hotkey}</kbd>}
                    </button>
                  );
                })}
              </div>

              <div className="runtime-controls">
                <button type="button" onClick={() => postRequest({ type: "setPaused", paused: !world.paused })}>
                  {world.paused ? "Run" : "Pause"}
                </button>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={world.speed === speed ? "is-active" : ""}
                    onClick={() => postRequest({ type: "setSpeed", speed })}
                  >
                    {speed}x
                  </button>
                ))}
                <button type="button" onClick={() => postRequest({ type: "reset", scenarioId })}>
                  Reset
                </button>
              </div>
            </div>

            {state.context.screen === "control" ? (
              <div className="queue-view">
                <div className="queue-summary">
                  <div>
                    <strong>{deferredQueue.length} cards pending</strong>
                    <span>
                      Autosave: {state.context.autosaveState} | Unlock floor: {scenario.unlockTrustFloor} trust
                    </span>
                  </div>
                  <div className="queue-summary__stats">
                    <span>{summary.frozenPacks} frozen packs</span>
                    <span>{world.policies.length} active policies</span>
                    <span>
                      {nextMilestone
                        ? `${Math.max(0, nextMilestone.triggerHour - world.clock.totalHours)}h to ${nextMilestone.title}`
                        : "Final milestone reached"}
                    </span>
                  </div>
                </div>

                <div className="queue-list">
                  {deferredQueue.map((card) => (
                    <QueueCard
                      key={card.id}
                      card={card}
                      selected={selectedCard?.id === card.id}
                      onSelect={(cardId) => send({ type: "SELECT_CARD", cardId })}
                      onDecision={handleDecision}
                    />
                  ))}
                  {!deferredQueue.length && (
                    <p className="empty-state">
                      Queue is clear. Resume the sim to generate work, then capture routine yellow and orange work as policy.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <ScreenContent
                screen={state.context.screen}
                world={world}
                scenario={scenario}
                selectedCard={selectedCard}
                selectedPackId={state.context.selectedPackId}
                onSelectPack={(packId) => openPackScreen(packId)}
              />
            )}
          </section>

          <aside className="right-rail panel">
            <TrustGauge trust={world.trust} lastTrustDelta={world.lastTrustDelta} />

            <section className="sidebar-section">
              <h2>Demo Brief</h2>
              <p>{scenario.description}</p>
              <ul className="brief-list">
                {scenario.onboardingChecklist.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
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

            <section className="sidebar-section">
              <h2>Selected Pack</h2>
              <div className="inspector-card">
                <strong>{selectedPack.name}</strong>
                <span>Phase {selectedPack.phase}</span>
                <span>{selectedPack.winSignal}</span>
                <span>
                  {selectedPackFreezeHours > 0
                    ? `Cooling down for ${selectedPackFreezeHours}h`
                    : selectedPackState.unlocked
                      ? "Operational"
                      : "Locked"}
                </span>
              </div>
            </section>

            <section className="sidebar-section">
              <h2>Selected Card</h2>
              {selectedCard ? (
                <div className="inspector-card">
                  <strong>{selectedCard.title}</strong>
                  <span>{selectedCard.entityRef.label}</span>
                  <span>{selectedCard.actionType}</span>
                  <span>{selectedCard.provenance[0]}</span>
                </div>
              ) : (
                <p className="empty-state">Select a card to inspect it.</p>
              )}
            </section>
          </aside>
        </section>

        <footer className="footer-bar panel">
          <span>Entities {summary.entities}</span>
          <span>Agents {summary.activeAgents} active</span>
          <span>{summary.idleAgents} idle</span>
          <span>{summary.quarantinedAgents} quarantined</span>
          <span>Policies {world.policies.length}</span>
          <span>Trust delta {world.lastTrustDelta.toFixed(2)}</span>
          <span>Frozen packs {summary.frozenPacks}</span>
        </footer>
      </div>

      <section className="toast-stack" aria-live="polite" aria-label="Control room notifications">
        {toasts.map((toast) => (
          <article key={toast.id} className={`toast toast--${toast.severity}`}>
            <div>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast__dismiss"
              onClick={() => setToasts((current) => current.filter((candidate) => candidate.id !== toast.id))}
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
              <button type="button" onClick={() => setBriefingOpen(false)}>
                Close
              </button>
            </div>

            <p>{scenario.description}</p>

            <div className="briefing-grid">
              <article className="briefing-panel">
                <h3>Control loop</h3>
                <p>Stay paused long enough to orient. Use Run and Pause to decide when intake happens.</p>
              </article>
              <article className="briefing-panel">
                <h3>Speed</h3>
                <p>{scenario.defaultSpeed}x is the default demo pace. Burst to 4x only after policies are carrying routine work.</p>
              </article>
              <article className="briefing-panel">
                <h3>Unlocks</h3>
                <p>Keep trust above {scenario.unlockTrustFloor} and watch Capital milestones to bring the next pack online fast.</p>
              </article>
            </div>

            <ul className="brief-list">
              {scenario.onboardingChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="modal-card__actions">
              <button type="button" onClick={() => setBriefingOpen(false)}>
                Stay paused
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  setBriefingOpen(false);
                  postRequest({ type: "setSpeed", speed: scenario.defaultSpeed });
                  postRequest({ type: "setPaused", paused: false });
                }}
              >
                Start at {scenario.defaultSpeed}x
              </button>
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
              <button type="button" onClick={() => setCatastropheModal(null)}>
                Close
              </button>
            </div>

            <div className="catastrophe-ticker">
              {catastropheModal.scriptLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>

            <p>{catastropheModal.recoveryText}</p>
            <div className="detail-grid">
              <div>
                <strong>{PACK_SHORT_NAMES[catastropheModal.packId]}</strong>
                <p>Freeze window: {catastropheModal.freezePackHours > 0 ? `${catastropheModal.freezePackHours}h` : "No freeze"}</p>
              </div>
              <div>
                <strong>Blast radius</strong>
                <p>
                  Trust {catastropheModal.trustPenalty} | Cash {currency(catastropheModal.cashPenalty)}
                </p>
              </div>
            </div>

            <div className="modal-card__actions">
              <button
                type="button"
                onClick={() => {
                  openPackScreen(catastropheModal.packId, "compliance");
                  setCatastropheModal(null);
                }}
              >
                Open compliance
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  openPackScreen(catastropheModal.packId, "packs");
                  setCatastropheModal(null);
                }}
              >
                Inspect pack
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export function ScreenContent({
  screen,
  world,
  scenario,
  selectedCard,
  selectedPackId,
  onSelectPack
}: {
  screen: ScreenId;
  world: WorldSnapshot;
  scenario: ScenarioDefinitionV1;
  selectedCard: ApprovalCardV1 | null;
  selectedPackId: PackId;
  onSelectPack: (packId: PackId) => void;
}) {
  const selectedPack = packById[selectedPackId];
  const selectedPackState = world.packs[selectedPackId];
  const selectedPackFreezeHours = freezeHoursRemaining(selectedPackState, world.clock.totalHours);
  const selectedPackAccuracy = accuracyForPack(selectedPackState);
  const activeFreezes = PACK_IDS.filter((packId) => freezeHoursRemaining(world.packs[packId], world.clock.totalHours) > 0);
  const policyWarnings = world.policies.flatMap((policy) => {
    const warnings: string[] = [];
    if (policy.stats.overrideRate > 0.15) {
      warnings.push(`${policy.name} is drifting. Override rate is ${(policy.stats.overrideRate * 100).toFixed(1)}%.`);
    }
    if (policy.stats.trustDelta < 0) {
      warnings.push(`${policy.name} has net negative trust impact at ${policy.stats.trustDelta.toFixed(2)}.`);
    }
    return warnings;
  });

  switch (screen) {
    case "trends":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Trends</h2>
              <p>Trust, queue pressure, and ARR over the live session.</p>
            </div>
          </div>
          <Suspense fallback={<div className="chart-shell chart-shell--loading">Loading trend telemetry...</div>}>
            <TrendsPanel world={world} />
          </Suspense>
        </section>
      );

    case "entity":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Entity Inspector</h2>
              <p>Provenance, operator rationale, and the current pack context for the selected work item.</p>
            </div>
          </div>
          {selectedCard ? (
            <div className="detail-grid">
              <div className="detail-card">
                <h3>{selectedCard.entityRef.label}</h3>
                <p>{selectedCard.summary}</p>
                <p>Pack: {PACK_SHORT_NAMES[selectedCard.packId]}</p>
                <p>Action: {selectedCard.actionType}</p>
                <p>Confidence: {Math.round(selectedCard.confidence * 100)}%</p>
              </div>
              <div className="detail-card">
                <h3>Provenance</h3>
                <ul className="detail-list">
                  {selectedCard.provenance.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-card">
                <h3>Evidence</h3>
                <ul className="detail-list">
                  {selectedCard.evidence.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="empty-state">Select a card to inspect its entity and provenance chain.</p>
          )}
        </section>
      );

    case "policy":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Policy Engine</h2>
              <p>Capture routine work, then watch override and trust signals for drift.</p>
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-card">
              <h3>Policy outcomes</h3>
              <p>{world.policies.length} active policies</p>
              <p>{world.policies.reduce((sum, policy) => sum + policy.stats.totalMatches, 0)} total matches</p>
            </div>
            <div className="detail-card">
              <h3>Drift warnings</h3>
              <ul className="detail-list">
                {policyWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {!policyWarnings.length && <li>No drift warnings. Capture more routine work to widen the surface area.</li>}
              </ul>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pack</th>
                  <th>Action</th>
                  <th>Matches</th>
                  <th>Override rate</th>
                  <th>Trust delta</th>
                </tr>
              </thead>
              <tbody>
                {world.policies.map((policy) => (
                  <tr key={policy.id}>
                    <td>{policy.name}</td>
                    <td>{PACK_SHORT_NAMES[policy.packId]}</td>
                    <td>{policy.actionType}</td>
                    <td>{policy.stats.totalMatches}</td>
                    <td>{(policy.stats.overrideRate * 100).toFixed(1)}%</td>
                    <td>{policy.stats.trustDelta.toFixed(2)}</td>
                  </tr>
                ))}
                {!world.policies.length && (
                  <tr>
                    <td colSpan={6}>No policies yet. Use Always approve on a routine yellow or orange card.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      );

    case "org":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Org</h2>
              <p>Agent staffing and reliability across the unlocked control-room surface.</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Pack</th>
                  <th>Status</th>
                  <th>Reliability</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {world.agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td>{agent.name}</td>
                    <td>{PACK_SHORT_NAMES[agent.packId]}</td>
                    <td>{agent.status}</td>
                    <td>{Math.round(agent.reliability * 100)}%</td>
                    <td>v{agent.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );

    case "capital":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Capital</h2>
              <p>Demo pacing is scenario-backed. Funding tranches, not hidden locked-pack economics, drive the unlock curve.</p>
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-card">
              <h3>Runway</h3>
              <p>Cash: {currency(world.cash)}</p>
              <p>ARR: {currency(world.arr)}</p>
              <p>Valuation: {currency(world.valuation)}</p>
            </div>
            <div className="detail-card">
              <h3>Unlock gate</h3>
              <p>Trust floor: {scenario.unlockTrustFloor}</p>
              <p>Queue soft cap: {scenario.queueSoftCap}</p>
              <p>Backlog alarm: {scenario.backlogAlarmThreshold}</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Grant</th>
                  <th>Trigger</th>
                  <th>Funding</th>
                  <th>Trust</th>
                </tr>
              </thead>
              <tbody>
                {scenario.grantMilestones.map((milestone) => {
                  const granted = world.grantedMilestones.includes(milestone.id);
                  return (
                    <tr key={milestone.id}>
                      <td>{granted ? "Granted" : `In ${Math.max(0, milestone.triggerHour - world.clock.totalHours)}h`}</td>
                      <td>{milestone.title}</td>
                      <td>{milestone.triggerHour}h</td>
                      <td>{currency(milestone.cashGrant)}</td>
                      <td>{milestone.trustBonus > 0 ? `+${milestone.trustBonus}` : milestone.trustBonus}</td>
                    </tr>
                  );
                })}
                {!scenario.grantMilestones.length && (
                  <tr>
                    <td colSpan={5}>This scenario has no scripted grant milestones.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      );

    case "market":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Market</h2>
              <p>Each pack stays legible in the public demo through its market signal, customers, and signature risk.</p>
            </div>
          </div>
          <div className="pack-grid">
            {PACK_IDS.map((packId) => {
              const pack = packById[packId];
              const packState = world.packs[packId];
              return (
                <article key={packId} className="pack-card" onClick={() => onSelectPack(packId)}>
                  <header>
                    <h3>{pack.name}</h3>
                    <span>{packState.unlocked ? "Live" : "Locked"}</span>
                  </header>
                  <p>{pack.keyMechanic}</p>
                  <p>{pack.winSignal}</p>
                  <p>Customers: {packState.activeCustomers}</p>
                  <p>Queue pressure: {packState.queuePressure}</p>
                </article>
              );
            })}
          </div>
        </section>
      );

    case "compliance":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Compliance</h2>
              <p>Freeze windows, anomaly pressure, and catastrophic history across the live nine-pack showcase.</p>
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-card">
              <h3>Active freezes</h3>
              <ul className="detail-list">
                {activeFreezes.map((packId) => (
                  <li key={packId}>
                    {packById[packId].name}: {freezeHoursRemaining(world.packs[packId], world.clock.totalHours)}h remaining
                  </li>
                ))}
                {!activeFreezes.length && <li>No active freezes.</li>}
              </ul>
            </div>
            <div className="detail-card">
              <h3>Anomalies</h3>
              <ul className="detail-list">
                {world.anomalies.map((anomaly) => (
                  <li key={anomaly.id}>
                    {anomaly.title} - {anomaly.reason}
                  </li>
                ))}
                {!world.anomalies.length && <li>No anomalies detected.</li>}
              </ul>
            </div>
            <div className="detail-card">
              <h3>Catastrophic history</h3>
              <ul className="detail-list">
                {world.catastrophicHistory.map((event) => (
                  <li key={`${event.id}-${event.triggeredAtHour}`}>
                    {event.title} ({PACK_SHORT_NAMES[event.packId]}) - {event.freezePackHours}h freeze
                  </li>
                ))}
                {!world.catastrophicHistory.length && <li>No catastrophic history.</li>}
              </ul>
            </div>
          </div>
        </section>
      );

    case "packs":
      return (
        <section className="screen-panel">
          <div className="screen-panel__header">
            <div>
              <h2>Pack Roadmap</h2>
              <p>Pack identity comes from phase, tutorial arc, win signal, and signature failure mode.</p>
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-card detail-card--hero">
              <h3>{selectedPack.name}</h3>
              <p>{selectedPack.keyMechanic}</p>
              <p>Phase {selectedPack.phase}</p>
              <p>{selectedPack.tutorialArc}</p>
              <p>Win signal: {selectedPack.winSignal}</p>
              <p>Signature event: {selectedPack.signatureEventKey}</p>
              <p>{selectedPackFreezeHours > 0 ? `Frozen for ${selectedPackFreezeHours}h` : "No active freeze"}</p>
              <p>
                Pack progress: {selectedPackState.resolvedCards} resolved,{" "}
                {selectedPackAccuracy === null ? "no accuracy signal yet" : `${selectedPackAccuracy}% correct`},{" "}
                {selectedPackState.policiesCreated} policies
              </p>
            </div>
            <div className="detail-card">
              <h3>Compliance modes</h3>
              <ul className="detail-list">
                {selectedPack.complianceModes.map((mode) => (
                  <li key={mode}>{mode}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="pack-grid">
            {packCatalog.map((pack) => {
              const packState = world.packs[pack.id];
              return (
                <article key={pack.id} className="pack-card" onClick={() => onSelectPack(pack.id)}>
                  <header>
                    <h3>{pack.name}</h3>
                    <span>{PACK_SHORT_NAMES[pack.id]}</span>
                  </header>
                  <p>Phase {pack.phase}</p>
                  <p>{pack.tutorialArc}</p>
                  <p>{pack.winSignal}</p>
                  <p>{packState.unlocked ? "Unlocked" : `Unlock ${currency(packState.unlockCost)}`}</p>
                </article>
              );
            })}
          </div>
        </section>
      );

    default:
      return null;
  }
}
