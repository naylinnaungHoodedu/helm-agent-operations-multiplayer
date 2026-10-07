import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const TARGET_DAYS = 5; 

async function play3PlayerCycle() {
  console.log("🎮 [Multiplayer 3P] Requesting new game room...");
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  const { roomCode } = await res.json();
  
  console.log(`🎮 [Multiplayer 3P] Room created: ${roomCode}. Spawning P1 (Host), P2, and P3...`);
  
  const p1 = io(SERVER_URL, { transports: ["websocket"] });
  const p2 = io(SERVER_URL, { transports: ["websocket"] });
  const p3 = io(SERVER_URL, { transports: ["websocket"] });

  let gameStarted = false;
  let currentDay = -1;
  let p1Decisions = 0;
  let p2Decisions = 0;
  let p3Decisions = 0;
  
  let localQueue: any[] = [];
  let localTrust = 0;
  let localArr = 0;
  
  let p1Packs: string[] = [];
  let p2Packs: string[] = [];
  let p3Packs: string[] = [];
  
  let p1Joined = false;
  let p2Joined = false;
  let p3Joined = false;

  const tryStart = () => {
     if (p1Joined && p2Joined && p3Joined) {
        console.log("🚀 [Host] All 3 players ready. Initiating Game Start...");
        p1.emit("game:start");
        setTimeout(() => {
           console.log("▶️ [Host] Unpausing the simulation & setting Speed 4...");
           p1.emit("game:setSpeed", 4);
           p1.emit("game:setPaused", false);
        }, 500);
     }
  };

  const joinLobby = (socket: any, name: string, onJoin: () => void) => {
      socket.emit("lobby:join", { code: roomCode, playerName: name }, (res: any) => {
        if (res.success) {
          console.log(`✅ [${name}] Joined lobby. Readying up...`);
          socket.emit("lobby:ready", true);
          onJoin();
        }
      });
  };

  p1.on("connect", () => {
      joinLobby(p1, "Player 1 (Host)", () => { p1Joined = true; tryStart(); });
  });

  p2.on("connect", () => {
      setTimeout(() => joinLobby(p2, "Player 2", () => { p2Joined = true; tryStart(); }), 200);
  });

  p3.on("connect", () => {
      setTimeout(() => joinLobby(p3, "Player 3", () => { p3Joined = true; tryStart(); }), 400);
  });
  
  p1.on("lobby:update", (state: any) => {
      const p1Info = state.players.find((p: any) => p.name === "Player 1 (Host)");
      const p2Info = state.players.find((p: any) => p.name === "Player 2");
      const p3Info = state.players.find((p: any) => p.name === "Player 3");
      if (p1Info) p1Packs = p1Info.assignedPacks;
      if (p2Info) p2Packs = p2Info.assignedPacks;
      if (p3Info) p3Packs = p3Info.assignedPacks;
  });

  p1.on("game:started", (state: any) => {
    gameStarted = true;
    localQueue = state.fullState.queue || [];
    localTrust = state.fullState.trust;
    localArr = state.fullState.arr;
    
    console.log(`\n========================================================`);
    console.log(`🌍 3-PLAYER WORLD INITIALIZED`);
    console.log(`P1 Packs: ${p1Packs.join(", ")}`);
    console.log(`P2 Packs: ${p2Packs.join(", ")}`);
    console.log(`P3 Packs: ${p3Packs.join(", ")}`);
    console.log(`========================================================\n`);
  });

  const handleTick = (delta: any) => {
    if (!gameStarted) return;
    
    if (delta.type === "tick" || delta.type === "decision") {
        localTrust = delta.trust;
        localArr = delta.arr;
        if (delta.queue) localQueue = delta.queue; 
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
        console.log(`\n🏆 [3-Player Multiplayer] TARGET REACHED: ${TARGET_DAYS} Days Completed.`);
        console.log(`📈 P1 Decisions: ${p1Decisions}`);
        console.log(`📈 P2 Decisions: ${p2Decisions}`);
        console.log(`📈 P3 Decisions: ${p3Decisions}`);
        console.log(`💰 Final ARR: $${localArr.toLocaleString()}`);
        console.log(`🛡️ Final Trust: ${localTrust.toFixed(1)}`);
        console.log(`🏁 Cycle Complete. Disconnecting.`);
        p1.disconnect();
        p2.disconnect();
        p3.disconnect();
        process.exit(0);
      }
    }
    
    if (localQueue.length > 0) {
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
          localQueue.shift();
      } else if (p2Packs.includes(card.packId)) {
          console.log(`   └─ [P2] Triaging: ${card.title} (${card.packId}) -> ${decision.toUpperCase()}`);
          p2.emit("game:decision", { cardId: card.id, decision }, (ack: any) => {
            if (ack && ack.success) p2Decisions++;
          });
          localQueue.shift();
      } else if (p3Packs.includes(card.packId)) {
          console.log(`   └─ [P3] Triaging: ${card.title} (${card.packId}) -> ${decision.toUpperCase()}`);
          p3.emit("game:decision", { cardId: card.id, decision }, (ack: any) => {
            if (ack && ack.success) p3Decisions++;
          });
          localQueue.shift();
      } else {
          localQueue.shift();
      }
    }
  };

  p1.on("game:tick", handleTick);
}

play3PlayerCycle().catch(console.error);
