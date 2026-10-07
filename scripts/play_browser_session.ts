import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const roomCode = process.argv[2];

if (!roomCode) {
    console.error("Please provide a room code");
    process.exit(1);
}

async function spawn3Bots(roomCode: string) {
  console.log(`🎮 [Multiplayer Bots] Spawning P2, P3, and P4 into room ${roomCode}...`);
  
  const p2 = io(SERVER_URL, { transports: ["websocket"] });
  const p3 = io(SERVER_URL, { transports: ["websocket"] });
  const p4 = io(SERVER_URL, { transports: ["websocket"] });

  let gameStarted = false;
  
  let p2Packs: string[] = [];
  let p3Packs: string[] = [];
  let p4Packs: string[] = [];

  const joinLobby = (socket: any, name: string) => {
      socket.emit("lobby:join", { code: roomCode, playerName: name }, (res: any) => {
        if (res.success) {
          console.log(`✅ [${name}] Joined lobby. Readying up...`);
          socket.emit("lobby:ready", true);
        } else {
          console.error(`❌ [${name}] Failed to join lobby: ${res.error}`);
        }
      });
  };

  p2.on("connect", () => joinLobby(p2, "Bot 2"));
  p3.on("connect", () => setTimeout(() => joinLobby(p3, "Bot 3"), 200));
  p4.on("connect", () => setTimeout(() => joinLobby(p4, "Bot 4"), 400));
  
  p2.on("lobby:update", (state: any) => {
      const p2Info = state.players.find((p: any) => p.name === "Bot 2");
      const p3Info = state.players.find((p: any) => p.name === "Bot 3");
      const p4Info = state.players.find((p: any) => p.name === "Bot 4");
      if (p2Info) { p2Packs.length = 0; p2Packs.push(...p2Info.assignedPacks); }
      if (p3Info) { p3Packs.length = 0; p3Packs.push(...p3Info.assignedPacks); }
      if (p4Info) { p4Packs.length = 0; p4Packs.push(...p4Info.assignedPacks); }
  });

  p2.on("game:started", () => {
    gameStarted = true;
    console.log(`🌍 BOT SQUAD INITIALIZED`);
  });

  let queues: any[][] = [[], [], []];
  
  const createTickHandler = (playerIndex: number, playerPacks: string[], playerSocket: any) => (delta: any) => {
    if (!gameStarted) return;
    
    if (delta.type === "tick" || delta.type === "decision") {
        if (delta.queue) queues[playerIndex] = delta.queue; 
    }
    
    if (queues[playerIndex].length > 0) {
      // Pick random chance to act so they don't spam instantly
      if (Math.random() < 0.3) {
          const card = queues[playerIndex][0];
          
          if (playerPacks.includes(card.packId)) {
            let decision = "approve";
            if (card.severity === "black") decision = "quarantine";
            else if (card.severity === "red") decision = "escalate";
            else if (card.severity === "orange") decision = "edit";
            if (card.expectedDecision) decision = card.expectedDecision;

            playerSocket.emit("game:decision", { cardId: card.id, decision }, () => {});
            queues[playerIndex].shift();
          }
      }
    }
    
    // Auto-terminate on game over
    if (delta.gameOver) {
        console.log("Mission ended. Disconnecting bots.");
        p2.disconnect();
        p3.disconnect();
        p4.disconnect();
        process.exit(0);
    }
  };

  p2.on("game:tick", createTickHandler(0, p2Packs, p2));
  p3.on("game:tick", createTickHandler(1, p3Packs, p3));
  p4.on("game:tick", createTickHandler(2, p4Packs, p4));
}

spawn3Bots(roomCode).catch(console.error);
