import type { ScenarioId } from "@helm/content-schema";
import type { PackId } from "@helm/entity-graph";
import type { GameDecisionInput, SaveGameV1, WorldDelta, WorldSnapshot } from "@helm/sim-core";

export type ScreenId =
  | "control"
  | "trends"
  | "entity"
  | "policy"
  | "org"
  | "capital"
  | "market"
  | "compliance"
  | "packs";

export type WorkerRequest =
  | { type: "init"; scenarioId: ScenarioId; saveGame: SaveGameV1 | null }
  | { type: "setPaused"; paused: boolean }
  | { type: "setSpeed"; speed: 1 | 2 | 4 }
  | { type: "decision"; payload: GameDecisionInput }
  | { type: "unlockPack"; packId: PackId }
  | { type: "reset"; scenarioId?: ScenarioId };

export type WorkerEvent =
  | { type: "snapshot"; snapshot: WorldSnapshot; delta: WorldDelta; savePoint: boolean }
  | { type: "ready"; snapshot: WorldSnapshot }
  | { type: "error"; message: string };
