/**
 * Shared Socket.IO event types for HELM multiplayer.
 * This file is imported by both the server and the frontend client.
 */

import type { PackId } from "@helm/entity-graph";
import type { WorldState, WorldNotification, GameClock } from "@helm/sim-core";
import type { ApprovalCardV1, AlarmV1 } from "@helm/cards";
import type { PackUnlockState, AgentRecord, TrendPoint } from "@helm/entity-graph";
import type { AnomalyRecordV1, LedgerEntryV1 } from "@helm/trust-ledger";
import type { PolicyRuleV1 } from "@helm/policy-engine";
import type { CatastrophicEventResultV1 } from "@helm/events";
import type { ScenarioId } from "@helm/content-schema";

// ─── Room Model ───────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  assignedPacks: PackId[];
  connected: boolean;
}

export type RoomState = "lobby" | "ingame" | "postgame";

export interface GameRoom {
  code: string;
  scenarioId: ScenarioId;
  state: RoomState;
  players: Map<string, RoomPlayer>;
  world: WorldState | null;
  tickTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActivityAt: number;
}

// ─── Lobby State (sent to clients) ────────────────────────────────────────────

export interface LobbyState {
  code: string;
  scenarioId: ScenarioId;
  state: RoomState;
  players: Omit<RoomPlayer, never>[];
}

// ─── Tick Delta (full snapshot every tick to keep sync simple) ────────────────

export interface TickDeltaCore {
  spawnedCards: number;
  resolvedCards: number;
  trustDelta: number;
  notifications: WorldNotification[];
  queueDepth: number;
}

export interface TickDelta {
  type: "tick" | "decision" | "unlock";
  // Key world state fields (replaces the worker's full snapshot for network efficiency)
  clock: GameClock;
  trust: number;
  cash: number;
  arr: number;
  valuation: number;
  lastTrustDelta: number;
  queue: ApprovalCardV1[];
  alarms: AlarmV1[];
  anomalies: AnomalyRecordV1[];
  packs: Record<PackId, PackUnlockState>;
  agents: AgentRecord[];
  trends: TrendPoint[];
  policies: PolicyRuleV1[];
  grantedMilestones: string[];
  catastrophicHistory: CatastrophicEventResultV1[];
  delta: TickDeltaCore;
}

// ─── Socket.IO Event Maps ─────────────────────────────────────────────────────

export interface ClientToServerEvents {
  /** Join a room by code */
  "lobby:join": (
    payload: { code: string; playerName?: string },
    callback: (
      res:
        | { success: true; lobbyState: LobbyState; playerId: string; isHost: boolean }
        | { success: false; error: string }
    ) => void
  ) => void;

  /** Rejoin after disconnect */
  "game:rejoin": (
    payload: { code: string; playerId: string },
    callback: (
      res:
        | { success: true; lobbyState: LobbyState; fullState?: WorldState; playerId: string; isHost: boolean }
        | { success: false; error: string }
    ) => void
  ) => void;

  /** Toggle ready state */
  "lobby:ready": (ready: boolean) => void;

  /** Host assigns which packs each player manages */
  "lobby:assignPacks": (assignments: Record<string, PackId[]>) => void;

  /** Host starts the game */
  "game:start": () => void;

  /** Player makes a card decision */
  "game:decision": (
    payload: { cardId: string; decision: string; createPolicy?: boolean },
    callback?: (res: { success: boolean; error?: string }) => void
  ) => void;

  /** Unlock a skill pack */
  "game:unlockPack": (
    packId: string,
    callback?: (res: { success: boolean; error?: string }) => void
  ) => void;

  /** Host pauses/resumes simulation */
  "game:setPaused": (paused: boolean) => void;

  /** Host changes simulation speed */
  "game:setSpeed": (speed: number) => void;

  /** Broadcast which card this player is currently reviewing */
  "presence:focus": (cardId: string | null) => void;
}

export interface ServerToClientEvents {
  /** Lobby state changed (someone joined, left, readied up) */
  "lobby:update": (state: LobbyState) => void;

  /** Game has started — receive full initial world state */
  "game:started": (payload: { fullState: WorldState; lobbyState: LobbyState }) => void;

  /** Periodic world delta from the sim tick or player decision */
  "game:tick": (delta: TickDelta) => void;

  /** Game ended (win or lose) */
  "game:over": (payload: {
    reason: "victory" | "trust_collapse" | "bankruptcy";
    message: string;
    finalState: WorldState;
  }) => void;

  /** Pause state changed */
  "game:paused": (payload: { paused: boolean }) => void;

  /** Speed changed */
  "game:speed": (payload: { speed: 1 | 2 | 4 }) => void;

  /** Another player focused a card */
  "presence:update": (payload: {
    playerId: string;
    playerName: string;
    focusedCardId: string | null;
  }) => void;

  /** Server-side error */
  "error": (message: string) => void;
}

export interface InterServerEvents {
  // For Redis horizontal scaling
}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
  playerName?: string;
}
