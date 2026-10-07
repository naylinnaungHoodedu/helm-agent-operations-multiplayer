import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const TARGET_DAYS = 7; 

async function playOneCycle() {
  console.log("🎮 [Bot] Requesting new game room...");
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  const { roomCode } = await res.json();
  
  console.log(`🎮 [Bot] Room created: ${roomCode}. Connecting via WebSocket...`);
  const socket = io(SERVER_URL, { transports: ["websocket"] });

  let gameStarted = false;
  let currentDay = -1;
  let totalDecisions = 0;
  let startingCash = 0;
  
  // Local state tracker
  let localQueue: any[] = [];
  let localTrust = 0;
  let localArr = 0;
  
  socket.on("connect", () => {
    socket.emit("lobby:join", { code: roomCode, playerName: "Antigravity AI" }, (res: any) => {
      if (res.success) {
        console.log("✅ [Bot] Joined lobby successfully. Signaling ready state...");
        socket.emit("lobby:ready", true);
        setTimeout(() => {
          console.log("🚀 [Bot] Initiating Game Start sequence...");
          socket.emit("game:start");
          
          setTimeout(() => {
             console.log("▶️ [Bot] Unpausing the simulation & setting Speed 4...");
             socket.emit("game:setSpeed", 4);
             socket.emit("game:setPaused", false);
          }, 500);
        }, 500);
      }
    });
  });

  socket.on("game:started", (state: any) => {
    gameStarted = true;
    startingCash = state.fullState.cash;
    localQueue = state.fullState.queue || [];
    localTrust = state.fullState.trust;
    localArr = state.fullState.arr;
    
    console.log(`\n========================================================`);
    console.log(`🌍 WORLD INITIALIZED | Scenario: ${state.fullState.scenarioId}`);
    console.log(`💰 Starting Cash: $${startingCash.toLocaleString()} | 🛡️ Trust: ${localTrust}`);
    console.log(`========================================================\n`);
  });

  socket.on("game:tick", (delta: any) => {
    if (!gameStarted) return;
    
    // Apply Delta
    if (delta.type === "tick") {
        localTrust = delta.trust;
        localArr = delta.arr;
        if (delta.queueAdditions) {
           localQueue.push(...delta.queueAdditions);
        }
        if (delta.queueRemovals) {
           localQueue = localQueue.filter(c => !delta.queueRemovals.includes(c.id));
        }
    } else if (delta.type === "decision") {
        localTrust = delta.trust;
        if (delta.resolvedCardId) {
            localQueue = localQueue.filter(c => c.id !== delta.resolvedCardId);
        }
    }
    
    const clock = delta.clock;
    if (!clock) return;

    if (clock.day > currentDay) {
      currentDay = clock.day;
      if (currentDay > 0) {
          console.log(`\n📅 --- Day ${currentDay} | Time: ${clock.label} ---`);
          console.log(`💼 ARR: $${localArr.toLocaleString()} | 🛡️ Trust: ${localTrust.toFixed(1)}`);
      }
      
      if (currentDay >= TARGET_DAYS) {
        console.log(`\n🏆 [Bot] TARGET REACHED: ${TARGET_DAYS} Days Completed.`);
        console.log(`📈 Final Decisions Made: ${totalDecisions}`);
        console.log(`💰 Final ARR: $${localArr.toLocaleString()}`);
        console.log(`🛡️ Final Trust: ${localTrust.toFixed(1)}`);
        console.log(`🏁 Cycle Complete. Disconnecting.`);
        socket.disconnect();
        process.exit(0);
      }
    }

    // Process the Queue
    if (localQueue.length > 0) {
      // Pick a random card to process every few ticks to avoid spamming 10hz exactly, or just process the first one
      if (Math.random() > 0.3) {
          const card = localQueue[0];
          
          let decision = "approve";
          if (card.severity === "black") decision = "quarantine";
          else if (card.severity === "red") decision = "escalate";
          else if (card.severity === "orange") decision = "edit";
          
          if (card.expectedDecision) {
             decision = card.expectedDecision;
          }
    
          console.log(`   └─ ⚡ Triaging: [${card.severity.toUpperCase()}] ${card.title} -> ${decision.toUpperCase()}`);
          
          socket.emit("game:decision", { cardId: card.id, decision, createPolicy: false }, (ack: any) => {
            if (ack && ack.success) {
              totalDecisions++;
              // Optimistically remove
              localQueue = localQueue.filter(c => c.id !== card.id);
            }
          });
      }
    }
  });

  socket.on("game:notification", (notif: any) => {
    console.log(`   🔔 NOTIFICATION: ${notif.title} - ${notif.message}`);
  });
}

playOneCycle().catch(console.error);
