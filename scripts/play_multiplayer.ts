import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const TARGET_DAYS = 5; 

async function playMultiplayerCycle() {
  console.log("🎮 [Multiplayer] Requesting new game room...");
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  const { roomCode } = await res.json();
  
  console.log(`🎮 [Multiplayer] Room created: ${roomCode}. Spawning Player 1 (Host) and Player 2...`);
  
  const p1 = io(SERVER_URL, { transports: ["websocket"] });
  const p2 = io(SERVER_URL, { transports: ["websocket"] });

  let gameStarted = false;
  let currentDay = -1;
  let p1Decisions = 0;
  let p2Decisions = 0;
  
  let localQueue: any[] = [];
  let localTrust = 0;
  let localArr = 0;
  
  // Track assigned packs
  let p1Packs: string[] = [];
  let p2Packs: string[] = [];
  
  let p1Joined = false;
  let p2Joined = false;

  const tryStart = () => {
     if (p1Joined && p2Joined) {
        console.log("🚀 [Host] Initiating Game Start sequence...");
        p1.emit("game:start");
        setTimeout(() => {
           console.log("▶️ [Host] Unpausing the simulation & setting Speed 4...");
           p1.emit("game:setSpeed", 4);
           p1.emit("game:setPaused", false);
        }, 500);
     }
  };

  p1.on("connect", () => {
    p1.emit("lobby:join", { code: roomCode, playerName: "Player 1 (Host)" }, (res: any) => {
      if (res.success) {
        console.log("✅ [P1] Joined lobby. Signaling ready...");
        p1.emit("lobby:ready", true);
        p1Joined = true;
        tryStart();
      }
    });
  });

  p2.on("connect", () => {
    // Slight delay to ensure P1 is host
    setTimeout(() => {
        p2.emit("lobby:join", { code: roomCode, playerName: "Player 2" }, (res: any) => {
          if (res.success) {
            console.log("✅ [P2] Joined lobby. Signaling ready...");
            p2.emit("lobby:ready", true);
            p2Joined = true;
            tryStart();
          }
        });
    }, 200);
  });
  
  p1.on("lobby:update", (state: any) => {
      const p1Info = state.players.find((p: any) => p.name === "Player 1 (Host)");
      const p2Info = state.players.find((p: any) => p.name === "Player 2");
      if (p1Info) p1Packs = p1Info.assignedPacks;
      if (p2Info) p2Packs = p2Info.assignedPacks;
  });

  p1.on("game:started", (state: any) => {
    gameStarted = true;
    localQueue = state.fullState.queue || [];
    localTrust = state.fullState.trust;
    localArr = state.fullState.arr;
    
    console.log(`\n========================================================`);
    console.log(`🌍 MULTIPLAYER WORLD INITIALIZED`);
    console.log(`P1 Packs: ${p1Packs.join(", ")}`);
    console.log(`P2 Packs: ${p2Packs.join(", ")}`);
    console.log(`========================================================\n`);
  });

  const handleTick = (delta: any) => {
    if (!gameStarted) return;
    
    if (delta.type === "tick" || delta.type === "decision") {
        localTrust = delta.trust;
        localArr = delta.arr;
        if (delta.queue) localQueue = delta.queue; // CORRECT: sync whole queue
    }
    
    const clock = delta.clock;
    if (!clock) return;

    if (clock.day > currentDay) {
      currentDay = clock.day;
      if (currentDay > 0) {
          console.log(`\n📅 --- Day ${currentDay} | Time: ${clock.label} ---`);
          console.log(`💼 ARR: $${localArr.toLocaleString()} | 🛡️ Trust: ${localTrust.toFixed(1)} | Queue: ${localQueue.length}`);
      }
      
      if (currentDay >= TARGET_DAYS) {
        console.log(`\n🏆 [Multiplayer] TARGET REACHED: ${TARGET_DAYS} Days Completed.`);
        console.log(`📈 P1 Decisions: ${p1Decisions}`);
        console.log(`📈 P2 Decisions: ${p2Decisions}`);
        console.log(`💰 Final ARR: $${localArr.toLocaleString()}`);
        console.log(`🛡️ Final Trust: ${localTrust.toFixed(1)}`);
        console.log(`🏁 Cycle Complete. Disconnecting.`);
        p1.disconnect();
        p2.disconnect();
        process.exit(0);
      }
    }
    
    if (localQueue.length > 0) {
      // Pick top card
      const card = localQueue[0];
      
      let decision = "approve";
      if (card.severity === "black") decision = "quarantine";
      else if (card.severity === "red") decision = "escalate";
      else if (card.severity === "orange") decision = "edit";
      if (card.expectedDecision) decision = card.expectedDecision;

      if (p1Packs.includes(card.packId)) {
          console.log(`   └─ [P1] Triaging: ${card.title} (${card.packId}) -> ${decision.toUpperCase()}`);
          p1.emit("game:decision", { cardId: card.id, decision }, (ack: any) => {
            if (ack && ack.success) p1Decisions++;
          });
          // Optimistic remove so P2 doesn't grab it
          localQueue.shift();
      } else if (p2Packs.includes(card.packId)) {
          console.log(`   └─ [P2] Triaging: ${card.title} (${card.packId}) -> ${decision.toUpperCase()}`);
          p2.emit("game:decision", { cardId: card.id, decision }, (ack: any) => {
            if (ack && ack.success) p2Decisions++;
          });
          // Optimistic remove
          localQueue.shift();
      } else {
          // If neither owns it (maybe a bug, or they didn't join right), just shift to avoid infinite loop
          localQueue.shift();
      }
    }
  };

  p1.on("game:tick", handleTick);
}

playMultiplayerCycle().catch(console.error);
