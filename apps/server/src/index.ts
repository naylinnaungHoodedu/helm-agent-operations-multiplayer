/**
 * HELM: Agent Operations — Multiplayer Server
 * Authoritative game server: Socket.IO v4 + in-memory state
 * (Redis adapter optional for horizontal scaling)
 *
 * Architecture:
 *  - Each multiplayer room has its own WorldState managed server-side
 *  - The sim tick loop runs server-side (not in a browser worker)
 *  - Players send intents; server validates & applies them
 *  - Full state is sent on join; delta diffs on every tick/decision
 *  - Single-player solo mode is the existing Vite app (no server needed)
 */

import { createServer } from "node:http";
import { createRequire } from "node:module";
import cors from "cors";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";
import { z } from "zod";

// ─── Content ────────────────────────────────────────────────────────────────
// Use createRequire to import JSON in ESM context
const require = createRequire(import.meta.url);
const packsCatalog = require("@helm/content-schema/../../../content/packs/packs.v1.json");
const cardsCatalog = require("@helm/content-schema/../../../content/cards/templates.v1.json");
const eventsCatalog = require("@helm/content-schema/../../../content/events/cinematics.v1.json");
const scenariosCatalog = require("@helm/content-schema/../../../content/scenarios/scenarios.v1.json");

import { parseGameContentBundle } from "@helm/content-schema";
import {
  applyDecision,
  canUnlockPack,
  createInitialWorld,
  createSaveGame,
  tickWorld,
  unlockPack,
  type WorldState,
} from "@helm/sim-core";
import { PACK_IDS, type PackId } from "@helm/entity-graph";
import type { CardDecision } from "@helm/cards";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
  LobbyState,
  RoomPlayer,
  GameRoom,
  TickDelta,
} from "./types.js";

// ─── Content Bundle ──────────────────────────────────────────────────────────
const CONTENT = parseGameContentBundle({
  packs: packsCatalog,
  cards: cardsCatalog,
  events: eventsCatalog,
  scenarios: scenariosCatalog,
});

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const TICK_INTERVAL_MS = 1000; // 1 real second = 1 in-game hour at speed 1
const MAX_PLAYERS_PER_ROOM = 4;
const ROOM_TTL_MS = 30 * 60 * 1000; // 30 min idle before cleanup
const DISCONNECT_GRACE_MS = 60 * 1000; // 60s grace before removing player slot
const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

// ─── In-Memory Room Store ────────────────────────────────────────────────────
const rooms = new Map<string, GameRoom>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── HTTP + Socket.IO ────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

const httpServer = createServer(app);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rooms: rooms.size,
    uptime: Math.round(process.uptime()),
  });
});

app.post("/api/rooms", (req, res) => {
  handleCreateRoom(req, res);
});

// Serve frontend statically
const distPath = path.join(__dirname, "../../game/dist");
app.use(express.static(distPath));

app.use((req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: FRONTEND_URL, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: DISCONNECT_GRACE_MS,
    skipMiddlewares: true,
  },
});

// ─── Input Validation Schemas ────────────────────────────────────────────────
const DecisionSchema = z.object({
  cardId: z.string().min(1).max(128),
  decision: z.enum(["approve", "edit", "reject", "escalate", "quarantine"]),
  createPolicy: z.boolean().optional().default(false),
});

const PackIdSchema = z.enum(PACK_IDS as unknown as [PackId, ...PackId[]]);

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(socketId);
  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(socketId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// ─── Room Helpers ────────────────────────────────────────────────────────────
function buildLobbyState(room: GameRoom): LobbyState {
  return {
    code: room.code,
    scenarioId: room.scenarioId,
    state: room.state,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      assignedPacks: p.assignedPacks,
      connected: p.connected,
    })),
  };
}

function assignPacksToPlayers(room: GameRoom): void {
  const players = [...room.players.values()].filter((p) => p.connected);
  const packCount = PACK_IDS.length;
  const playerCount = players.length;

  players.forEach((player) => {
    player.assignedPacks = [];
  });

  PACK_IDS.forEach((packId, index) => {
    const playerIndex = index % playerCount;
    players[playerIndex]!.assignedPacks.push(packId);
  });

  // unused variable guard
  void packCount;
}

function getPlayerForSocket(socketId: string): { room: GameRoom; player: RoomPlayer } | null {
  for (const room of rooms.values()) {
    const player = room.players.get(socketId);
    if (player) return { room, player };
  }
  return null;
}

function stopRoomTick(room: GameRoom): void {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function startRoomTick(room: GameRoom): void {
  stopRoomTick(room);
  if (!room.world || room.world.paused || room.state !== "ingame") return;

  const intervalMs = TICK_INTERVAL_MS / room.world.speed;

  room.tickTimer = setInterval(() => {
    if (!room.world || room.state !== "ingame") {
      stopRoomTick(room);
      return;
    }

    const result = tickWorld(room.world, CONTENT);
    room.world = { ...result.snapshot };

    const delta: TickDelta = {
      type: "tick",
      clock: result.snapshot.clock,
      trust: result.snapshot.trust,
      cash: result.snapshot.cash,
      arr: result.snapshot.arr,
      valuation: result.snapshot.valuation,
      lastTrustDelta: result.snapshot.lastTrustDelta,
      queue: result.snapshot.queue,
      alarms: result.snapshot.alarms,
      anomalies: result.snapshot.anomalies,
      packs: result.snapshot.packs,
      agents: result.snapshot.agents,
      trends: result.snapshot.trends,
      policies: result.snapshot.policies,
      grantedMilestones: result.snapshot.grantedMilestones,
      catastrophicHistory: result.snapshot.catastrophicHistory,
      delta: {
        spawnedCards: result.delta.spawnedCards,
        resolvedCards: result.delta.resolvedCards,
        trustDelta: result.delta.trustDelta,
        notifications: result.delta.notifications,
        queueDepth: result.delta.queueDepth,
      },
    };

    io.to(`room:${room.code}`).emit("game:tick", delta);

    // Check win/lose
    if (result.snapshot.trust < 20) {
      stopRoomTick(room);
      room.state = "postgame";
      io.to(`room:${room.code}`).emit("game:over", {
        reason: "trust_collapse",
        message: "Trust collapsed below 20. The platform has lost operator confidence.",
        finalState: result.snapshot,
      });
    } else if (result.snapshot.cash < 0) {
      stopRoomTick(room);
      room.state = "postgame";
      io.to(`room:${room.code}`).emit("game:over", {
        reason: "bankruptcy",
        message: "You ran out of cash. The company is bankrupt.",
        finalState: result.snapshot,
      });
    } else if (result.snapshot.arr >= 1_000_000_000 && result.snapshot.trust >= 90) {
      stopRoomTick(room);
      room.state = "postgame";
      io.to(`room:${room.code}`).emit("game:over", {
        reason: "victory",
        message: "You reached $1B ARR with Trust ≥ 90. The platform is operational at scale.",
        finalState: result.snapshot,
      });
    }
  }, intervalMs);
}

function cleanupRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  stopRoomTick(room);
  rooms.delete(code);
}

// ─── REST: Create Room ────────────────────────────────────────────────────────
function handleCreateRoom(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  const code = nanoid();
  const url = new URL(req.url || "", 'http://localhost');
  const scenarioId = (url.searchParams.get("scenario") as any) || "public-demo";
  const room: GameRoom = {
    code,
    scenarioId,
    state: "lobby",
    players: new Map(),
    world: null,
    tickTimer: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(code, room);

  // Auto-cleanup idle rooms
  setTimeout(() => {
    const r = rooms.get(code);
    if (r && r.state === "lobby" && Date.now() - r.lastActivityAt > ROOM_TTL_MS) {
      cleanupRoom(code);
    }
  }, ROOM_TTL_MS + 5000);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ roomCode: code }));
}

// ─── Socket.IO Connection Handler ────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Join Room ──────────────────────────────────────────────────────────────
  socket.on("lobby:join", (payload, callback) => {
    const { code, playerName } = payload;

    if (!code || typeof code !== "string" || code.length !== 6) {
      callback({ success: false, error: "Invalid room code." });
      return;
    }

    const room = rooms.get(code.toUpperCase());
    if (!room) {
      callback({ success: false, error: "Room not found. Check the code and try again." });
      return;
    }

    if (room.state !== "lobby") {
      callback({ success: false, error: "Game already in progress. Reconnect with your player ID." });
      return;
    }

    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      callback({ success: false, error: "Room is full." });
      return;
    }

    const name = typeof playerName === "string" && playerName.trim().length > 0
      ? playerName.trim().slice(0, 24)
      : `Operator ${room.players.size + 1}`;

    const isHost = room.players.size === 0;
    const player: RoomPlayer = {
      id: socket.id,
      name,
      isHost,
      isReady: false,
      assignedPacks: [],
      connected: true,
    };

    room.players.set(socket.id, player);
    room.lastActivityAt = Date.now();

    socket.data.roomCode = code.toUpperCase();
    socket.data.playerId = socket.id;
    socket.data.playerName = name;

    void socket.join(`room:${code.toUpperCase()}`);

    assignPacksToPlayers(room);
    const lobbyState = buildLobbyState(room);

    callback({ success: true, lobbyState, playerId: socket.id, isHost });
    socket.to(`room:${code.toUpperCase()}`).emit("lobby:update", lobbyState);

    console.log(`[join] ${name} (${socket.id}) → room ${code}`);
  });

  // ── Reconnect to In-Progress Game ─────────────────────────────────────────
  socket.on("game:rejoin", (payload, callback) => {
    const { code, playerId } = payload;
    const room = rooms.get(code?.toUpperCase() ?? "");
    if (!room) {
      callback({ success: false, error: "Room not found." });
      return;
    }

    // Find the disconnected player slot
    const existingPlayer = [...room.players.values()].find(
      (p) => p.id === playerId && !p.connected
    );

    if (!existingPlayer) {
      callback({ success: false, error: "No matching disconnected player found." });
      return;
    }

    // Cancel the pending disconnect timer
    const timer = disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(playerId);
    }

    // Update socket mapping
    room.players.delete(playerId);
    existingPlayer.id = socket.id;
    existingPlayer.connected = true;
    room.players.set(socket.id, existingPlayer);

    socket.data.roomCode = code.toUpperCase();
    socket.data.playerId = socket.id;
    socket.data.playerName = existingPlayer.name;

    void socket.join(`room:${code.toUpperCase()}`);

    const lobbyState = buildLobbyState(room);
    io.to(`room:${code.toUpperCase()}`).emit("lobby:update", lobbyState);

    if (room.state === "ingame" && room.world) {
      callback({
        success: true,
        fullState: room.world,
        lobbyState,
        playerId: socket.id,
        isHost: existingPlayer.isHost,
      });
    } else {
      callback({ success: true, lobbyState, playerId: socket.id, isHost: existingPlayer.isHost });
    }

    console.log(`[rejoin] ${existingPlayer.name} (${socket.id}) → room ${code}`);
  });

  // ── Ready Toggle ──────────────────────────────────────────────────────────
  socket.on("lobby:ready", (ready) => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || ctx.room.state !== "lobby") return;
    ctx.player.isReady = ready;
    ctx.room.lastActivityAt = Date.now();
    const lobbyState = buildLobbyState(ctx.room);
    io.to(`room:${ctx.room.code}`).emit("lobby:update", lobbyState);
  });

  // ── Host Assigns Packs ────────────────────────────────────────────────────
  socket.on("lobby:assignPacks", (assignments) => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || !ctx.player.isHost || ctx.room.state !== "lobby") return;

    for (const [playerId, packs] of Object.entries(assignments)) {
      const player = ctx.room.players.get(playerId);
      if (player && Array.isArray(packs)) {
        player.assignedPacks = packs.filter((p): p is PackId =>
          PACK_IDS.includes(p as PackId)
        );
      }
    }
    const lobbyState = buildLobbyState(ctx.room);
    io.to(`room:${ctx.room.code}`).emit("lobby:update", lobbyState);
  });

  // ── Host Starts Game ──────────────────────────────────────────────────────
  socket.on("game:start", () => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || !ctx.player.isHost || ctx.room.state !== "lobby") return;

    const room = ctx.room;
    const connectedPlayers = [...room.players.values()].filter((p) => p.connected);

    if (connectedPlayers.length === 0) return;

    // Initialize the world
    const seed = Date.now();
    room.world = createInitialWorld({
      seed,
      content: CONTENT,
      scenarioId: room.scenarioId,
    });
    room.state = "ingame";
    room.lastActivityAt = Date.now();

    const fullState = room.world;
    const lobbyState = buildLobbyState(room);

    io.to(`room:${room.code}`).emit("game:started", { fullState, lobbyState });
    startRoomTick(room);

    console.log(`[start] room ${room.code} with ${connectedPlayers.length} players, seed ${seed}`);
  });

  // ── Card Decision ─────────────────────────────────────────────────────────
  socket.on("game:decision", (payload, callback) => {
    if (!checkRateLimit(socket.id)) {
      callback?.({ success: false, error: "Rate limit exceeded. Slow down." });
      return;
    }

    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || ctx.room.state !== "ingame" || !ctx.room.world) {
      callback?.({ success: false, error: "No active game." });
      return;
    }

    // Validate input
    const parsed = DecisionSchema.safeParse(payload);
    if (!parsed.success) {
      callback?.({ success: false, error: "Invalid decision payload." });
      return;
    }

    const { cardId, decision, createPolicy } = parsed.data;
    const room = ctx.room;
    const world = room.world;

    // Server-side authorization: player must own the pack this card belongs to
    if (!world) { callback?.({ success: false, error: 'No world' }); return; }
    const card = world.queue.find((c) => c.id === cardId);
    if (!card) {
      callback?.({ success: false, error: "Card not in queue." });
      return;
    }

    const playerOwnsCard = ctx.player.assignedPacks.includes(card.packId)
      || [...room.players.values()].length === 1; // single-player fallback
    if (!playerOwnsCard) {
      callback?.({ success: false, error: "You don't own this pack." });
      return;
    }

    try {
      const result = applyDecision(world, CONTENT, {
        cardId,
        decision: decision as Exclude<CardDecision, "ack">,
        createPolicy: createPolicy ?? false,
      });

      room.world = { ...result.snapshot };
      room.lastActivityAt = Date.now();

      // Stop and restart tick at correct speed if speed changed
      stopRoomTick(room);
      startRoomTick(room);

      const delta: TickDelta = {
        type: "decision",
        clock: result.snapshot.clock,
        trust: result.snapshot.trust,
        cash: result.snapshot.cash,
        arr: result.snapshot.arr,
        valuation: result.snapshot.valuation,
        lastTrustDelta: result.snapshot.lastTrustDelta,
        queue: result.snapshot.queue,
        alarms: result.snapshot.alarms,
        anomalies: result.snapshot.anomalies,
        packs: result.snapshot.packs,
        agents: result.snapshot.agents,
        trends: result.snapshot.trends,
        policies: result.snapshot.policies,
        grantedMilestones: result.snapshot.grantedMilestones,
        catastrophicHistory: result.snapshot.catastrophicHistory,
        delta: {
          spawnedCards: result.delta.spawnedCards,
          resolvedCards: result.delta.resolvedCards,
          trustDelta: result.delta.trustDelta,
          notifications: result.delta.notifications,
          queueDepth: result.delta.queueDepth,
        },
      };

      // Broadcast to ALL players in room (including the actor)
      io.to(`room:${room.code}`).emit("game:tick", delta);

      callback?.({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Decision error.";
      callback?.({ success: false, error: message });
    }
  });

  // ── Unlock Pack ───────────────────────────────────────────────────────────
  socket.on("game:unlockPack", (packIdRaw, callback) => {
    if (!checkRateLimit(socket.id)) {
      callback?.({ success: false, error: "Rate limit exceeded." });
      return;
    }

    const parsed = PackIdSchema.safeParse(packIdRaw);
    if (!parsed.success) {
      callback?.({ success: false, error: "Invalid pack ID." });
      return;
    }

    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || ctx.room.state !== "ingame" || !ctx.room.world) {
      callback?.({ success: false, error: "No active game." });
      return;
    }

    const room = ctx.room;
    const packId = parsed.data;

    if (!room.world || !canUnlockPack(room.world, CONTENT, packId)) {
      callback?.({ success: false, error: "Cannot unlock this pack yet." });
      return;
    }

    try {
      const result = unlockPack(room.world, CONTENT, packId);
      room.world = { ...result.snapshot };
      room.lastActivityAt = Date.now();

      stopRoomTick(room);
      startRoomTick(room);

      const delta: TickDelta = {
        type: "unlock",
        clock: result.snapshot.clock,
        trust: result.snapshot.trust,
        cash: result.snapshot.cash,
        arr: result.snapshot.arr,
        valuation: result.snapshot.valuation,
        lastTrustDelta: result.snapshot.lastTrustDelta,
        queue: result.snapshot.queue,
        alarms: result.snapshot.alarms,
        anomalies: result.snapshot.anomalies,
        packs: result.snapshot.packs,
        agents: result.snapshot.agents,
        trends: result.snapshot.trends,
        policies: result.snapshot.policies,
        grantedMilestones: result.snapshot.grantedMilestones,
        catastrophicHistory: result.snapshot.catastrophicHistory,
        delta: {
          spawnedCards: result.delta.spawnedCards,
          resolvedCards: result.delta.resolvedCards,
          trustDelta: result.delta.trustDelta,
          notifications: result.delta.notifications,
          queueDepth: result.delta.queueDepth,
        },
      };

      io.to(`room:${room.code}`).emit("game:tick", delta);
      callback?.({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unlock error.";
      callback?.({ success: false, error: message });
    }
  });

  // ── Pause / Speed ─────────────────────────────────────────────────────────
  socket.on("game:setPaused", (paused) => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || ctx.room.state !== "ingame" || !ctx.room.world) return;
    if (!ctx.player.isHost) return; // Only host can pause

    ctx.room.world = { ...ctx.room.world, paused };
    ctx.room.lastActivityAt = Date.now();
    stopRoomTick(ctx.room);
    if (!paused) startRoomTick(ctx.room);

    io.to(`room:${ctx.room.code}`).emit("game:paused", { paused });
  });

  socket.on("game:setSpeed", (speed) => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx || ctx.room.state !== "ingame" || !ctx.room.world) return;
    if (!ctx.player.isHost) return; // Only host can change speed

    const validSpeeds = [1, 2, 4] as const;
    if (!validSpeeds.includes(speed as 1 | 2 | 4)) return;

    ctx.room.world = { ...ctx.room.world, speed: speed as 1 | 2 | 4 };
    ctx.room.lastActivityAt = Date.now();
    stopRoomTick(ctx.room);
    if (!ctx.room.world.paused) startRoomTick(ctx.room);

    io.to(`room:${ctx.room.code}`).emit("game:speed", { speed: speed as 1 | 2 | 4 });
  });

  // ── Presence: Card Focus ──────────────────────────────────────────────────
  socket.on("presence:focus", (cardId) => {
    const ctx = getPlayerForSocket(socket.id);
    if (!ctx) return;

    // Volatile: fine to drop if congested
    socket.volatile.to(`room:${ctx.room.code}`).emit("presence:update", {
      playerId: socket.id,
      playerName: ctx.player.name,
      focusedCardId: typeof cardId === "string" ? cardId : null,
    });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);

    const ctx = getPlayerForSocket(socket.id);
    if (!ctx) return;

    const { room, player } = ctx;
    player.connected = false;
    room.lastActivityAt = Date.now();

    // Notify others of disconnection
    io.to(`room:${room.code}`).emit("lobby:update", buildLobbyState(room));

    // Grace period before removing the player slot
    const timer = setTimeout(() => {
      disconnectTimers.delete(socket.id);

      const r = rooms.get(room.code);
      if (!r) return;

      r.players.delete(socket.id);

      // Host migration
      const connectedPlayers = [...r.players.values()].filter((p) => p.connected);
      if (player.isHost && connectedPlayers.length > 0) {
        connectedPlayers[0]!.isHost = true;
        console.log(`[host-migration] ${connectedPlayers[0]!.name} is now host of room ${r.code}`);
      }

      // If no players remain, clean up
      if (r.players.size === 0 || connectedPlayers.length === 0) {
        cleanupRoom(r.code);
        console.log(`[cleanup] room ${r.code} removed (all players gone)`);
        return;
      }

      // Re-assign packs if someone left
      if (r.state === "lobby") {
        assignPacksToPlayers(r);
      }

      io.to(`room:${r.code}`).emit("lobby:update", buildLobbyState(r));
    }, DISCONNECT_GRACE_MS);

    disconnectTimers.set(socket.id, timer);

    rateLimitBuckets.delete(socket.id);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🎮 HELM Multiplayer Server`);
  console.log(`   Port:       ${PORT}`);
  console.log(`   Frontend:   ${FRONTEND_URL}`);
  console.log(`   Health:     http://localhost:${PORT}/health`);
  console.log(`   Rooms:      0 active\n`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n[shutdown] Received ${signal}. Cleaning up...`);
  for (const code of rooms.keys()) cleanupRoom(code);
  io.close();
  httpServer.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// trigger restart
