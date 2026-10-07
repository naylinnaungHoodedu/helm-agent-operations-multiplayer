import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const TARGET_DAYS = 7; 

async function play4PlayerCycle() {
  console.log("🎮 [Multiplayer 4P] Requesting new game room...");
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  const { roomCode } = await res.json();
  
  console.log(`🎮 [Multiplayer 4P] Room created: ${roomCode}. Spawning P1 (Host), P2, P3, and P4...`);
  
  const p1 = io(SERVER_URL, { transports: ["websocket"] });
  const p2 = io(SERVER_URL, { transports: ["websocket"] });
  const p3 = io(SERVER_URL, { transports: ["websocket"] });
  const p4 = io(SERVER_URL, { transports: ["websocket"] });

  let gameStarted = false;
  let currentDay = -1;
  let p1Decisions = 0;
  let p2Decisions = 0;
  let p3Decisions = 0;
  let p4Decisions = 0;
  
  let localQueue: any[] = [];
  let localTrust = 0;
  let localArr = 0;
  
  let p1Packs: string[] = [];
  let p2Packs: string[] = [];
  let p3Packs: string[] = [];
  let p4Packs: string[] = [];
  
  let p1Joined = false;
  let p2Joined = false;
  let p3Joined = false;
  let p4Joined = false;

  const tryStart = () => {
     if (p1Joined && p2Joined && p3Joined && p4Joined) {
        console.log("🚀 [Host] All 4 players ready. Initiating Game Start...");
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

  p4.on("connect", () => {
      setTimeout(() => joinLobby(p4, "Player 4", () => { p4Joined = true; tryStart(); }), 600);
  });
  
  p1.on("lobby:update", (state: any) => {
      const p1Info = state.players.find((p: any) => p.name === "Player 1 (Host)");
      const p2Info = state.players.find((p: any) => p.name === "Player 2");
      const p3Info = state.players.find((p: any) => p.name === "Player 3");
      const p4Info = state.players.find((p: any) => p.name === "Player 4");
      if (p1Info) { p1Packs.length = 0; p1Packs.push(...p1Info.assignedPacks); }
      if (p2Info) { p2Packs.length = 0; p2Packs.push(...p2Info.assignedPacks); }
      if (p3Info) { p3Packs.length = 0; p3Packs.push(...p3Info.assignedPacks); }
      if (p4Info) { p4Packs.length = 0; p4Packs.push(...p4Info.assignedPacks); }
  });

  p1.on("game:started", (state: any) => {
    gameStarted = true;
    localQueue = state.fullState.queue || [];
    localTrust = state.fullState.trust;
    localArr = state.fullState.arr;
    
    console.log(`\n========================================================`);
    console.log(`🌍 4-PLAYER WORLD INITIALIZED`);
    console.log(`P1 Packs: ${p1Packs.join(", ")}`);
    console.log(`P2 Packs: ${p2Packs.join(", ")}`);
    console.log(`P3 Packs: ${p3Packs.join(", ")}`);
    console.log(`P4 Packs: ${p4Packs.join(", ")}`);
    console.log(`========================================================\n`);
  });

  let queues: any[][] = [[], [], [], []];
  let decisions = [0, 0, 0, 0];
  
  const createTickHandler = (playerIndex: number, playerPacks: string[], playerSocket: any, isHost: boolean = false) => (delta: any) => {
    if (!gameStarted) return;
    
    if (delta.type === "tick" || delta.type === "decision") {
        if (isHost) {
          localTrust = delta.trust;
          localArr = delta.arr;
        }
        if (delta.queue) queues[playerIndex] = delta.queue; 
    }
    
    const clock = delta.clock;
    if (!clock) return;

    if (isHost && clock.day > currentDay) {
      currentDay = clock.day;
      if (currentDay > 0) {
          console.log(`\n📅 --- Day ${currentDay} | Time: ${clock.label} ---`);
          console.log(`💼 ARR: $${localArr.toLocaleString()} | 🛡️ Trust: ${localTrust.toFixed(1)} | Queue: ${queues[0].length}`);
      }
      
      if (currentDay >= TARGET_DAYS) {
        console.log(`\n🏆 [4-Player Multiplayer] TARGET REACHED: ${TARGET_DAYS} Days Completed.`);
        console.log(`📈 P1 Decisions: ${decisions[0]}`);
        console.log(`📈 P2 Decisions: ${decisions[1]}`);
        console.log(`📈 P3 Decisions: ${decisions[2]}`);
        console.log(`📈 P4 Decisions: ${decisions[3]}`);
        console.log(`💰 Final ARR: $${localArr.toLocaleString()}`);
        console.log(`🛡️ Final Trust: ${localTrust.toFixed(1)}`);
        console.log(`🏁 Cycle Complete. Disconnecting.`);
        p1.disconnect();
        p2.disconnect();
        p3.disconnect();
        p4.disconnect();
        process.exit(0);
      }
    }
    
    if (queues[playerIndex].length > 0) {
      const card = queues[playerIndex][0];
      
      if (playerPacks.includes(card.packId)) {
        let decision = "approve";
        if (card.severity === "black") decision = "quarantine";
        else if (card.severity === "red") decision = "escalate";
        else if (card.severity === "orange") decision = "edit";
        if (card.expectedDecision) decision = card.expectedDecision;

        console.log(`   └─ [P${playerIndex + 1}] Triaging: ${card.title} (${card.packId}) -> ${decision.toUpperCase()}`);
        playerSocket.emit("game:decision", { cardId: card.id, decision }, (ack: any) => {
          if (ack && ack.success) {
            decisions[playerIndex]++;
          }
        });
        queues[playerIndex].shift();
      }
    }
  };

  p1.on("game:tick", createTickHandler(0, p1Packs, p1, true));
  p2.on("game:tick", createTickHandler(1, p2Packs, p2, false));
  p3.on("game:tick", createTickHandler(2, p3Packs, p3, false));
  p4.on("game:tick", createTickHandler(3, p4Packs, p4, false));
}

play4PlayerCycle().catch(console.error);
