import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const ROOMS_TO_CREATE = 5;
const PLAYERS_PER_ROOM = 4;
const TEST_DURATION_MS = 15000;

async function runLoadTest() {
  console.log(`🚀 Starting Multiplayer Load & Performance Test`);
  console.log(`Target: ${ROOMS_TO_CREATE} rooms, ${ROOMS_TO_CREATE * PLAYERS_PER_ROOM} concurrent clients`);

  let totalDecisions = 0;
  let rejectedDecisions = 0;
  let totalLatency = 0;
  let pingCount = 0;

  for (let r = 0; r < ROOMS_TO_CREATE; r++) {
    // 1. Create Room via REST
    const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
    if (!res.ok) {
      console.error("Failed to create room.");
      continue;
    }
    const { roomCode } = await res.json();
    console.log(`[Room ${roomCode}] Created`);

    const clients: ReturnType<typeof io>[] = [];
    
    for (let p = 0; p < PLAYERS_PER_ROOM; p++) {
      const socket = io(SERVER_URL, {
        reconnectionDelay: 100,
        transports: ["websocket"]
      });
      clients.push(socket);

      socket.on("connect", () => {
        socket.emit("lobby:join", { code: roomCode, playerName: `Bot_${r}_${p}` }, (res: any) => {
          if (res.success) {
            socket.emit("lobby:ready", true);
            
            // If host, start game after a short delay
            if (res.isHost) {
              setTimeout(() => socket.emit("game:start"), 1000);
            }
          }
        });
      });

      // Measure Sync Latency
      socket.on("game:tick", (delta) => {
        // We won't measure every tick to avoid console spam, but we track existence
        if (delta.type === "tick" && Math.random() < 0.05) {
          const start = Date.now();
          socket.volatile.emit("presence:focus", "ping");
          // Fake ping measurement (Socket.IO doesn't have native ping callback without ack, doing manual estimation)
        }
      });

      // Automated Playtest Loop (Phase 11)
      socket.on("game:started", (state) => {
        setInterval(() => {
          const queue = state.fullState?.queue || [];
          if (queue.length > 0) {
            const card = queue[0];
            const startReq = Date.now();
            socket.emit("game:decision", { cardId: card.id, decision: "approve", createPolicy: false }, (ack: any) => {
              const latency = Date.now() - startReq;
              totalLatency += latency;
              pingCount++;

              if (ack.success) {
                totalDecisions++;
              } else {
                rejectedDecisions++; // Usually rate limited or unauthorized
              }
            });
          }
        }, 800); // 800ms to stay just under the 5 req/sec rate limit
      });
    }
  }

  // Wait for test duration
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION_MS));

  console.log(`\n✅ Load Test Complete`);
  console.log(`--- Performance Metrics ---`);
  console.log(`Total Rooms: ${ROOMS_TO_CREATE}`);
  console.log(`Total Concurrent Operators: ${ROOMS_TO_CREATE * PLAYERS_PER_ROOM}`);
  console.log(`Total Decisions Processed: ${totalDecisions}`);
  console.log(`Decisions Rejected (Anti-Cheat/Rate Limit): ${rejectedDecisions}`);
  if (pingCount > 0) {
    console.log(`Average Input Delay (Ack Latency): ${(totalLatency / pingCount).toFixed(2)} ms`);
  }
  
  process.exit(0);
}

runLoadTest().catch(console.error);
