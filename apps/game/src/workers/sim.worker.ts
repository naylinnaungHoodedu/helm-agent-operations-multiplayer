/// <reference lib="webworker" />

import packsCatalog from "@content/packs/packs.v1.json";
import cardsCatalog from "@content/cards/templates.v1.json";
import eventsCatalog from "@content/events/cinematics.v1.json";
import scenariosCatalog from "@content/scenarios/scenarios.v1.json";
import {
  applyDecision,
  createInitialWorld,
  hydrateSaveGame,
  tickWorld,
  unlockPack,
  type WorldState
} from "@helm/sim-core";
import { parseGameContentBundle, type ScenarioId } from "@helm/content-schema";
import type { WorkerEvent, WorkerRequest } from "../game/protocol";

const content = parseGameContentBundle({
  packs: packsCatalog,
  cards: cardsCatalog,
  events: eventsCatalog,
  scenarios: scenariosCatalog
});

let world: WorldState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let currentScenarioId: ScenarioId = "public-demo";

const emit = (message: WorkerEvent) => {
  postMessage(message);
};

const emptyDelta = (queueDepth: number) => ({
  spawnedCards: 0,
  resolvedCards: 0,
  triggeredEvents: [],
  trustDelta: 0,
  queueDepth,
  notifications: []
});

const stopLoop = () => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};

const startLoop = () => {
  stopLoop();
  if (!world || world.paused) {
    return;
  }
  timer = setInterval(() => {
    if (!world) {
      return;
    }
    const result = tickWorld(world, content);
    world = { ...result.snapshot };
    emit({
      type: "snapshot",
      snapshot: result.snapshot,
      delta: result.delta,
      savePoint: world.tickCount % 8 === 0
    });
  }, 1000 / world.speed);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    switch (event.data.type) {
      case "init": {
        currentScenarioId = event.data.scenarioId;
        const saveGame =
          event.data.saveGame && event.data.saveGame.scenarioId === event.data.scenarioId ? event.data.saveGame : null;
        world = saveGame
          ? hydrateSaveGame(saveGame)
          : createInitialWorld({ content, scenarioId: event.data.scenarioId });
        emit({ type: "ready", snapshot: world });
        startLoop();
        break;
      }
      case "setPaused": {
        if (!world) {
          break;
        }
        world = { ...world, paused: event.data.paused };
        startLoop();
        emit({
          type: "snapshot",
          snapshot: world,
          delta: emptyDelta(world.queue.length),
          savePoint: false
        });
        break;
      }
      case "setSpeed": {
        if (!world) {
          break;
        }
        world = { ...world, speed: event.data.speed };
        startLoop();
        emit({
          type: "snapshot",
          snapshot: world,
          delta: emptyDelta(world.queue.length),
          savePoint: false
        });
        break;
      }
      case "decision": {
        if (!world) {
          break;
        }
        const result = applyDecision(world, content, event.data.payload);
        world = { ...result.snapshot };
        emit({
          type: "snapshot",
          snapshot: result.snapshot,
          delta: result.delta,
          savePoint: true
        });
        break;
      }
      case "unlockPack": {
        if (!world) {
          break;
        }
        const result = unlockPack(world, content, event.data.packId);
        world = { ...result.snapshot };
        emit({
          type: "snapshot",
          snapshot: result.snapshot,
          delta: result.delta,
          savePoint: true
        });
        break;
      }
      case "reset": {
        currentScenarioId = event.data.scenarioId ?? currentScenarioId;
        world = createInitialWorld({ content, scenarioId: currentScenarioId });
        emit({ type: "ready", snapshot: world });
        startLoop();
        break;
      }
    }
  } catch (error) {
    emit({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown simulation error."
    });
  }
};
