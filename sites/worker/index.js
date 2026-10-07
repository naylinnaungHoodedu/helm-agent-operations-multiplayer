const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const packs = [
  "Finance", "People", "Support", "Legal", "Security",
  "Growth", "Ops", "Compliance", "Treasury"
];

const cards = [
  {
    title: "Vendor invoice spike",
    pack: "Finance",
    severity: "yellow",
    summary: "An AI finance agent wants to pay a vendor invoice that is 3x the normal amount.",
    evidence: "Mismatch found between contract value and invoice amount.",
    expected: "escalate"
  },
  {
    title: "Customer refund batch",
    pack: "Support",
    severity: "green",
    summary: "Support automation prepared refunds for verified duplicate charges.",
    evidence: "All account IDs match the refund policy.",
    expected: "approve"
  },
  {
    title: "Suspicious login cluster",
    pack: "Security",
    severity: "red",
    summary: "The security agent sees repeated failed logins from unfamiliar regions.",
    evidence: "Velocity, ASN, and device fingerprint all changed.",
    expected: "quarantine"
  },
  {
    title: "Hiring recommendation",
    pack: "People",
    severity: "yellow",
    summary: "The recruiting agent recommends skipping interviews for a highly ranked candidate.",
    evidence: "The model score is strong, but interview evidence is missing.",
    expected: "edit"
  },
  {
    title: "Terms-of-service update",
    pack: "Legal",
    severity: "red",
    summary: "A legal agent generated a terms update using clauses from an unknown source.",
    evidence: "Source attribution is incomplete for two high-impact clauses.",
    expected: "escalate"
  },
  {
    title: "Ad budget expansion",
    pack: "Growth",
    severity: "green",
    summary: "The growth agent asks to move more budget into a campaign with clean conversion data.",
    evidence: "CAC is below target and churn signals remain stable.",
    expected: "approve"
  },
  {
    title: "Warehouse route change",
    pack: "Ops",
    severity: "yellow",
    summary: "The operations agent found a faster route but has not checked weather disruption.",
    evidence: "Route is cheaper, but reliability data is stale.",
    expected: "edit"
  },
  {
    title: "Medical data export",
    pack: "Compliance",
    severity: "red",
    summary: "A compliance agent asks to export sensitive customer records for analysis.",
    evidence: "Consent scope does not cover this export.",
    expected: "quarantine"
  },
  {
    title: "Treasury transfer",
    pack: "Treasury",
    severity: "red",
    summary: "A treasury agent proposes a large transfer to a newly created counterparty.",
    evidence: "Counterparty risk score changed in the last hour.",
    expected: "escalate"
  }
];

const actions = {
  approve: "Approve",
  edit: "Edit",
  escalate: "Escalate",
  quarantine: "Quarantine"
};

function roomCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function makeRoom() {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    code,
    createdAt: Date.now(),
    state: "lobby",
    players: new Map(),
    sockets: new Map(),
    score: 0,
    arr: 12000000,
    trust: 82,
    round: 0,
    queue: [nextCard(0), nextCard(1), nextCard(2)],
    log: ["Room created. Share the code and ready up together."],
    timer: null
  };
  rooms.set(code, room);
  scheduleCleanup(code);
  return room;
}

function nextCard(offset = 0) {
  const card = cards[Math.floor(Math.random() * cards.length)];
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${offset}`,
    ...card
  };
}

function snapshot(room) {
  return {
    code: room.code,
    state: room.state,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      host: player.host,
      pack: player.pack,
      connected: player.connected
    })),
    score: room.score,
    arr: room.arr,
    trust: room.trust,
    round: room.round,
    queue: room.queue,
    log: room.log.slice(-8),
    goal: "Reach $1B ARR while keeping trust at 70 or higher."
  };
}

function broadcast(room) {
  const data = JSON.stringify({ type: "snapshot", snapshot: snapshot(room) });
  for (const socket of room.sockets.values()) {
    try {
      socket.send(data);
    } catch {
      // Closed sockets are cleaned up by their close event.
    }
  }
}

function addLog(room, line) {
  room.log.push(line);
  room.log = room.log.slice(-12);
}

function scheduleCleanup(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (!room) return;
    const connected = [...room.players.values()].some((player) => player.connected);
    if (!connected || Date.now() - room.createdAt > 2 * 60 * 60 * 1000) {
      if (room.timer) clearInterval(room.timer);
      rooms.delete(code);
    } else {
      scheduleCleanup(code);
    }
  }, 10 * 60 * 1000);
}

function assignPacks(room) {
  [...room.players.values()].forEach((player, index) => {
    player.pack = packs[index % packs.length];
  });
}

function startGame(room) {
  if (room.state !== "lobby") return;
  room.state = "playing";
  room.round = 1;
  addLog(room, "Mission started. Triage cards together before trust slips.");
  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    if (room.state !== "playing") return;
    room.trust = Math.max(0, room.trust - 1);
    if (room.queue.length < 5) room.queue.push(nextCard());
    if (room.trust < 30) {
      room.state = "finished";
      addLog(room, "Trust collapsed. The control room lost confidence.");
      clearInterval(room.timer);
    }
    broadcast(room);
  }, 7000);
  broadcast(room);
}

function resolveCard(room, player, cardId, action) {
  if (room.state !== "playing") return;
  const index = room.queue.findIndex((card) => card.id === cardId);
  if (index < 0) return;
  const [card] = room.queue.splice(index, 1);
  const correct = card.expected === action;
  if (correct) {
    room.score += 10;
    room.trust = Math.min(100, room.trust + 3);
    room.arr = Math.min(1000000000, Math.round(room.arr * 1.34 + 7500000));
    addLog(room, `${player.name} made the right call: ${actions[action]} ${card.title}.`);
  } else {
    room.score = Math.max(0, room.score - 4);
    room.trust = Math.max(0, room.trust - 9);
    room.arr = Math.max(0, Math.round(room.arr * 0.96));
    addLog(room, `${player.name} chose ${actions[action]}, but ${card.title} needed ${actions[card.expected]}.`);
  }
  room.round += 1;
  while (room.queue.length < 3 && room.state === "playing") room.queue.push(nextCard());
  if (room.arr >= 1000000000 && room.trust >= 70) {
    room.state = "finished";
    addLog(room, "Victory: $1B ARR reached with trust intact.");
    if (room.timer) clearInterval(room.timer);
  } else if (room.trust < 30) {
    room.state = "finished";
    addLog(room, "Trust collapsed. The mission failed.");
    if (room.timer) clearInterval(room.timer);
  }
  broadcast(room);
}

function html() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HELM Agent Operations Multiplayer</title>
  <meta name="description" content="A live room-code multiplayer AI operations game built for the Create a Multiplayer Game challenge." />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2307111f'/%3E%3Cpath d='M7 21V9h3v4h12V9h3v12h-3v-5H10v5H7Z' fill='%2337e6c4'/%3E%3C/svg%3E">
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07111f; color: #e7f4f0; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #16435d 0, transparent 36rem), linear-gradient(135deg, #07111f, #0d1a2b 52%, #121827); }
    button, input { font: inherit; }
    button { border: 1px solid #376c74; background: #123243; color: #e7f4f0; border-radius: 8px; padding: .8rem 1rem; cursor: pointer; }
    button.primary { background: #37e6c4; color: #06201c; border-color: #37e6c4; font-weight: 800; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    input { width: 100%; border: 1px solid #315064; background: #081523; color: #f5fffc; border-radius: 8px; padding: .8rem 1rem; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0; }
    .top { display: flex; justify-content: space-between; gap: 1rem; align-items: center; margin-bottom: 18px; }
    .brand span { color: #37e6c4; font-size: .8rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: .35rem 0 0; font-size: clamp(1.8rem, 4vw, 3.7rem); line-height: 1; letter-spacing: 0; }
    .panel { border: 1px solid rgba(107, 157, 174, .32); background: rgba(7, 17, 31, .78); box-shadow: 0 24px 80px rgba(0,0,0,.28); border-radius: 8px; }
    .connect { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; padding: 20px; }
    .copy { padding: 10px; }
    .copy p { color: #b7c9cf; line-height: 1.6; font-size: 1.02rem; }
    .rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
    .rule { border: 1px solid rgba(55,230,196,.22); background: rgba(55,230,196,.08); border-radius: 8px; padding: 12px; min-height: 94px; }
    .rule strong { display: block; margin-bottom: 6px; }
    .forms { display: grid; gap: 12px; align-content: start; }
    .form-card { padding: 16px; display: grid; gap: 10px; }
    .game { display: none; grid-template-columns: 250px minmax(0,1fr) 280px; gap: 14px; }
    .game.active { display: grid; }
    .card, .side { padding: 16px; }
    .metric { display: grid; grid-template-columns: 1fr auto; gap: 8px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 10px 0; }
    .metric:last-child { border-bottom: 0; }
    .players, .log { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .players li, .log li { border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.04); border-radius: 8px; padding: 10px; color: #cfe2e6; }
    .queue { display: grid; gap: 12px; }
    .incident { padding: 16px; border-left: 5px solid #f0c95b; }
    .incident.red { border-left-color: #ff5c7a; }
    .incident.green { border-left-color: #37e6c4; }
    .incident h2 { margin: 0 0 8px; font-size: 1.25rem; }
    .incident p { color: #c9d8dc; line-height: 1.48; }
    .actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; }
    .pill { border: 1px solid rgba(55,230,196,.32); color: #a8fff0; border-radius: 999px; padding: .45rem .7rem; background: rgba(55,230,196,.08); font-size: .88rem; }
    .hidden { display: none !important; }
    @media (max-width: 900px) {
      .connect, .game.active { grid-template-columns: 1fr; }
      .rules, .actions { grid-template-columns: 1fr 1fr; }
      .top { align-items: flex-start; flex-direction: column; }
      .status { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <span>HELM multiplayer</span>
        <h1>Agent Operations</h1>
      </div>
      <div class="status">
        <span class="pill" id="connection">Offline</span>
        <span class="pill" id="roomPill">No room</span>
      </div>
    </header>

    <section class="connect panel" id="connectView">
      <div class="copy">
        <h2>Run a shared AI control room from any device.</h2>
        <p>Create a room, share the six-character code, and work together to approve, edit, escalate, or quarantine AI agent decisions. Every player sees the same incident queue and the same trust/ARR score.</p>
        <div class="rules">
          <div class="rule"><strong>1. Join</strong><span>Two to four operators enter one room code.</span></div>
          <div class="rule"><strong>2. Triage</strong><span>Pick the safest action for each incident.</span></div>
          <div class="rule"><strong>3. Scale</strong><span>Reach $1B ARR while keeping trust at 70+.</span></div>
        </div>
      </div>
      <div class="forms">
        <div class="form-card panel">
          <label>Operator name</label>
          <input id="name" maxlength="24" placeholder="Your callsign" />
          <button class="primary" id="create">Create Room</button>
        </div>
        <div class="form-card panel">
          <label>Room code</label>
          <input id="code" maxlength="6" placeholder="ABC123" />
          <button id="join">Join Room</button>
        </div>
      </div>
    </section>

    <main class="game" id="gameView">
      <aside class="side panel">
        <h2>Operators</h2>
        <ul class="players" id="players"></ul>
        <button class="primary" id="ready">Ready Up</button>
        <button id="start">Start Mission</button>
      </aside>

      <section class="card panel">
        <div id="mission"></div>
        <div class="queue" id="queue"></div>
      </section>

      <aside class="side panel">
        <h2>Mission</h2>
        <div class="metric"><span>ARR</span><strong id="arr">$0</strong></div>
        <div class="metric"><span>Trust</span><strong id="trust">0</strong></div>
        <div class="metric"><span>Score</span><strong id="score">0</strong></div>
        <div class="metric"><span>Round</span><strong id="round">0</strong></div>
        <h2>Activity</h2>
        <ul class="log" id="log"></ul>
      </aside>
    </main>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    let socket, me, latest;
    const fmt = new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 });
    const nameInput = $("name");
    const savedName = localStorage.getItem("helm-name");
    if (savedName) nameInput.value = savedName;

    $("create").onclick = async () => {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = await res.json();
      $("code").value = data.roomCode;
      connect(data.roomCode);
    };

    $("join").onclick = () => connect($("code").value.trim().toUpperCase());
    $("ready").onclick = () => send({ type: "ready" });
    $("start").onclick = () => send({ type: "start" });

    function connect(code) {
      const name = (nameInput.value || "Operator").trim().slice(0, 24);
      localStorage.setItem("helm-name", name);
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(protocol + "//" + location.host + "/ws?room=" + encodeURIComponent(code) + "&name=" + encodeURIComponent(name));
      $("connection").textContent = "Connecting";
      socket.onopen = () => $("connection").textContent = "Online";
      socket.onclose = () => $("connection").textContent = "Disconnected";
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "hello") me = msg.playerId;
        if (msg.snapshot) render(msg.snapshot);
      };
    }

    function send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }

    function render(state) {
      latest = state;
      $("connectView").classList.add("hidden");
      $("gameView").classList.add("active");
      $("roomPill").textContent = "Room " + state.code;
      $("arr").textContent = fmt.format(state.arr);
      $("trust").textContent = state.trust;
      $("score").textContent = state.score;
      $("round").textContent = state.round;
      $("mission").innerHTML = state.state === "finished"
        ? "<h2>Mission complete</h2><p>" + state.log[state.log.length - 1] + "</p>"
        : "<h2>" + (state.state === "lobby" ? "Lobby" : "Live incident queue") + "</h2><p>" + state.goal + "</p>";
      $("players").innerHTML = state.players.map((p) =>
        "<li><strong>" + escapeHtml(p.name) + (p.id === me ? " (You)" : "") + "</strong><br>" +
        escapeHtml(p.pack || "Assigning pack") + " · " + (p.host ? "Host" : "Operator") + " · " + (p.ready ? "Ready" : "Standby") + "</li>"
      ).join("");
      const mine = state.players.find((p) => p.id === me);
      $("ready").textContent = mine && mine.ready ? "Cancel Ready" : "Ready Up";
      $("ready").disabled = state.state !== "lobby";
      $("start").disabled = state.state !== "lobby" || !mine?.host || state.players.length < 2 || !state.players.every((p) => p.ready);
      $("queue").innerHTML = state.state === "lobby"
        ? "<article class='incident panel'><h2>Waiting for operators</h2><p>Share the room code. The host can start once at least two players are ready.</p></article>"
        : state.queue.map(cardHtml).join("");
      $("log").innerHTML = state.log.map((line) => "<li>" + escapeHtml(line) + "</li>").join("");
    }

    function cardHtml(card) {
      return "<article class='incident panel " + card.severity + "'><h2>" + escapeHtml(card.title) + "</h2>" +
        "<p><strong>" + escapeHtml(card.pack) + " · " + escapeHtml(card.severity.toUpperCase()) + "</strong></p>" +
        "<p>" + escapeHtml(card.summary) + "</p><p>" + escapeHtml(card.evidence) + "</p>" +
        "<div class='actions'>" + Object.entries({ approve: "Approve", edit: "Edit", escalate: "Escalate", quarantine: "Quarantine" }).map(([key, label]) =>
          "<button onclick=\"send({type:'action', cardId:'" + card.id + "', action:'" + key + "'})\">" + label + "</button>"
        ).join("") + "</div></article>";
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
  </script>
</body>
</html>`;
}

function handleSocket(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("room")?.toUpperCase();
  const name = (url.searchParams.get("name") || "Operator").trim().slice(0, 24);
  const room = rooms.get(code);
  if (!room) return new Response("Room not found", { status: 404 });

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  const playerId = crypto.randomUUID();
  const player = {
    id: playerId,
    name: name || "Operator",
    ready: false,
    host: room.players.size === 0,
    connected: true,
    pack: ""
  };
  room.players.set(playerId, player);
  room.sockets.set(playerId, server);
  assignPacks(room);
  server.accept();
  server.send(JSON.stringify({ type: "hello", playerId, snapshot: snapshot(room) }));
  broadcast(room);

  server.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "ready" && room.state === "lobby") {
      player.ready = !player.ready;
      addLog(room, `${player.name} is ${player.ready ? "ready" : "standing by"}.`);
      broadcast(room);
    }
    if (message.type === "start" && player.host) {
      const players = [...room.players.values()];
      if (players.length >= 2 && players.every((item) => item.ready)) startGame(room);
    }
    if (message.type === "action" && typeof message.cardId === "string" && typeof message.action === "string") {
      if (Object.hasOwn(actions, message.action)) resolveCard(room, player, message.cardId, message.action);
    }
  });

  server.addEventListener("close", () => {
    player.connected = false;
    room.sockets.delete(playerId);
    if (player.host) {
      const nextHost = [...room.players.values()].find((item) => item.connected);
      if (nextHost) nextHost.host = true;
    }
    broadcast(room);
  });

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const room = makeRoom();
      return Response.json({ roomCode: room.code });
    }
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleSocket(request);
    }
    return new Response(html(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};
