/**
 * useMultiplayerSocket — React hook managing the Socket.IO connection
 * to the HELM multiplayer server.
 *
 * Features:
 * - Auto-reconnect with stored playerId
 * - Full state sync on join / rejoin
 * - Optimistic UI (world updates immediately from server tick)
 * - Presence broadcasting (which card you're reviewing)
 */

import { useEffect, useCallback, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { WorldState } from "@helm/sim-core";
import type { PackId } from "@helm/entity-graph";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  assignedPacks: PackId[];
  connected: boolean;
}

export interface LobbyState {
  code: string;
  scenarioId: "standard" | "public-demo";
  state: "lobby" | "ingame" | "postgame";
  players: LobbyPlayer[];
}

export type MultiplayerPhase =
  | "disconnected"
  | "connecting"
  | "lobby"
  | "ingame"
  | "postgame"
  | "error";

export interface PresenceInfo {
  playerId: string;
  playerName: string;
  focusedCardId: string | null;
}

export interface MultiplayerState {
  phase: MultiplayerPhase;
  error: string | null;
  lobby: LobbyState | null;
  world: WorldState | null;
  myPlayerId: string | null;
  myPackIds: PackId[];
  isHost: boolean;
  presence: Record<string, PresenceInfo>;
  gameOver: {
    reason: "victory" | "trust_collapse" | "bankruptcy";
    message: string;
    finalState: WorldState;
  } | null;
}

const STORAGE_KEY_PLAYER_ID = "helm_player_id";
const STORAGE_KEY_ROOM_CODE = "helm_room_code";

const SERVER_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `${window.location.protocol}//${window.location.host}`
    : "http://localhost:3001";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiplayerSocket() {
  const socketRef = useRef<Socket | null>(null);

  const [state, setState] = useState<MultiplayerState>({
    phase: "disconnected",
    error: null,
    lobby: null,
    world: null,
    myPlayerId: null,
    myPackIds: [],
    isHost: false,
    presence: {},
    gameOver: null,
  });

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io(SERVER_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    setState((s) => ({ ...s, phase: "connecting", error: null }));

    socket.on("connect", () => {
      console.log("[mp] connected", socket.id);

      // Attempt rejoin if we have stored session
      const storedPlayerId = sessionStorage.getItem(STORAGE_KEY_PLAYER_ID);
      const storedCode = sessionStorage.getItem(STORAGE_KEY_ROOM_CODE);

      if (storedPlayerId && storedCode) {
        socket.emit("game:rejoin", { code: storedCode, playerId: storedPlayerId }, (res: any) => {
          if (res.success) {
            sessionStorage.setItem(STORAGE_KEY_PLAYER_ID, res.playerId);
            setState((s) => ({
              ...s,
              phase: res.fullState ? "ingame" : "lobby",
              lobby: res.lobbyState,
              world: res.fullState ?? s.world,
              myPlayerId: res.playerId,
              isHost: res.isHost,
              myPackIds:
                res.lobbyState.players.find((p: any) => p.id === res.playerId)?.assignedPacks ?? [],
            }));
          } else {
            // Session expired — clear and show disconnected
            sessionStorage.removeItem(STORAGE_KEY_PLAYER_ID);
            sessionStorage.removeItem(STORAGE_KEY_ROOM_CODE);
            setState((s) => ({ ...s, phase: "lobby" }));
          }
        });
      } else {
        setState((s) => ({ ...s, phase: "lobby" }));
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("[mp] disconnected", reason);
      setState((s) => ({
        ...s,
        phase: s.phase === "ingame" ? "ingame" : "disconnected", // keep showing game during temp disconnect
      }));
    });

    socket.on("connect_error", (err) => {
      setState((s) => ({ ...s, phase: "error", error: err.message }));
    });

    socket.on("lobby:update", (lobbyState) => {
      setState((s) => ({
        ...s,
        lobby: lobbyState,
        phase: lobbyState.state === "lobby" ? "lobby" : s.phase,
        myPackIds:
          lobbyState.players.find((p: any) => p.id === s.myPlayerId)?.assignedPacks ?? s.myPackIds,
        isHost: lobbyState.players.find((p: any) => p.id === s.myPlayerId)?.isHost ?? s.isHost,
      }));
    });

    socket.on("game:started", ({ fullState, lobbyState }) => {
      setState((s) => ({
        ...s,
        phase: "ingame",
        world: fullState,
        lobby: lobbyState,
        myPackIds:
          lobbyState.players.find((p: any) => p.id === s.myPlayerId)?.assignedPacks ?? s.myPackIds,
      }));
    });

    socket.on("game:tick", (delta) => {
      setState((s) => {
        if (!s.world) return s;
        // Merge the delta into our world snapshot
        return {
          ...s,
          world: {
            ...s.world,
            clock: delta.clock,
            trust: delta.trust,
            cash: delta.cash,
            arr: delta.arr,
            valuation: delta.valuation,
            lastTrustDelta: delta.lastTrustDelta,
            queue: delta.queue,
            alarms: delta.alarms,
            anomalies: delta.anomalies,
            packs: delta.packs,
            agents: delta.agents,
            trends: delta.trends,
            policies: delta.policies,
            grantedMilestones: delta.grantedMilestones,
            catastrophicHistory: delta.catastrophicHistory,
          },
        };
      });
    });

    socket.on("game:over", (payload) => {
      setState((s) => ({
        ...s,
        phase: "postgame",
        gameOver: payload,
        world: payload.finalState,
      }));
    });

    socket.on("game:paused", ({ paused }) => {
      setState((s) =>
        s.world ? { ...s, world: { ...s.world, paused } } : s
      );
    });

    socket.on("game:speed", ({ speed }) => {
      setState((s) =>
        s.world ? { ...s, world: { ...s.world, speed } } : s
      );
    });

    socket.on("presence:update", (info) => {
      setState((s) => ({
        ...s,
        presence: { ...s.presence, [info.playerId]: info },
      }));
    });

    socket.on("error", (message) => {
      console.error("[mp] server error:", message);
    });
  }, []);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    sessionStorage.removeItem(STORAGE_KEY_PLAYER_ID);
    sessionStorage.removeItem(STORAGE_KEY_ROOM_CODE);
    setState({
      phase: "disconnected",
      error: null,
      lobby: null,
      world: null,
      myPlayerId: null,
      myPackIds: [],
      isHost: false,
      presence: {},
      gameOver: null,
    });
  }, []);

  // ── Create Room ───────────────────────────────────────────────────────────
  const createRoom = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { roomCode: string };
      return data.roomCode;
    } catch (err) {
      setState((s) => ({ ...s, error: "Could not create room. Is the server running?" }));
      return null;
    }
  }, []);

  // ── Join Room ─────────────────────────────────────────────────────────────
  const joinRoom = useCallback(
    (code: string, playerName: string): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected to server." });
          return;
        }

        socket.emit("lobby:join", { code, playerName }, (res: any) => {
          if (res.success) {
            sessionStorage.setItem(STORAGE_KEY_PLAYER_ID, res.playerId);
            sessionStorage.setItem(STORAGE_KEY_ROOM_CODE, code.toUpperCase());
            setState((s) => ({
              ...s,
              phase: "lobby",
              lobby: res.lobbyState,
              myPlayerId: res.playerId,
              isHost: res.isHost,
              myPackIds:
                res.lobbyState.players.find((p: any) => p.id === res.playerId)?.assignedPacks ?? [],
            }));
          }
          resolve(res);
        });
      });
    },
    []
  );

  // ── Ready Toggle ──────────────────────────────────────────────────────────
  const setReady = useCallback((ready: boolean) => {
    socketRef.current?.emit("lobby:ready", ready);
  }, []);

  // ── Start Game ────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    socketRef.current?.emit("game:start");
  }, []);

  // ── Card Decision ─────────────────────────────────────────────────────────
  const makeDecision = useCallback(
    (
      cardId: string,
      decision: string,
      createPolicy = false
    ): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected." });
          return;
        }
        socket.emit("game:decision", { cardId, decision, createPolicy }, (res: any) => {
          resolve(res ?? { success: true });
        });
      });
    },
    []
  );

  // ── Unlock Pack ───────────────────────────────────────────────────────────
  const unlockPack = useCallback(
    (packId: string): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected." });
          return;
        }
        socket.emit("game:unlockPack", packId, (res: any) => {
          resolve(res ?? { success: true });
        });
      });
    },
    []
  );

  // ── Pause / Speed ─────────────────────────────────────────────────────────
  const setPaused = useCallback((paused: boolean) => {
    socketRef.current?.emit("game:setPaused", paused);
  }, []);

  const setSpeed = useCallback((speed: number) => {
    socketRef.current?.emit("game:setSpeed", speed);
  }, []);

  // ── Presence ──────────────────────────────────────────────────────────────
  const focusCard = useCallback((cardId: string | null) => {
    socketRef.current?.volatile.emit("presence:focus", cardId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return {
    state,
    connect,
    disconnect,
    createRoom,
    joinRoom,
    setReady,
    startGame,
    makeDecision,
    unlockPack,
    setPaused,
    setSpeed,
    focusCard,
  };
}

