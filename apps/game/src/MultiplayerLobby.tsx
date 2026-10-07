import { useState } from "react";
import { useMultiplayerSocket } from "./hooks/useMultiplayerSocket";
import { audio } from "./audio";
import { PACK_IDS, PACK_SHORT_NAMES } from "@helm/entity-graph";

export function MultiplayerLobby({ socket }: { socket: ReturnType<typeof useMultiplayerSocket> }) {
  const [joinCode, setJoinCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleCreate = async () => {
    setCreating(true);
    setErrorMsg("");
    const code = await socket.createRoom();
    if (code) {
      const res = await socket.joinRoom(code, playerName || "Host");
      if (!res.success) setErrorMsg(res.error || "Failed to join created room.");
    } else {
      setErrorMsg(socket.state.error || "Could not create room.");
    }
    setCreating(false);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length !== 6) {
      setErrorMsg("Room code must be 6 characters.");
      return;
    }
    setJoining(true);
    setErrorMsg("");
    const res = await socket.joinRoom(joinCode.toUpperCase(), playerName || "Operator");
    if (!res.success) setErrorMsg(res.error || "Failed to join room.");
    setJoining(false);
  };

  if (socket.state.phase === "lobby" && socket.state.lobby) {
    const { lobby, myPlayerId, isHost } = socket.state;
    const myPlayer = lobby.players.find(p => p.id === myPlayerId);
    const allReady = lobby.players.length > 0 && lobby.players.every(p => p.isReady);

    return (
      <main className="boot-screen">
        <section className="modal-card">
          <div className="modal-card__header">
            <div>
              <span className="eyebrow">HELM MULTIPLAYER</span>
              <h2>Room Lobby: {lobby.code}</h2>
              <p>Scenario: {lobby.scenarioId}</p>
            </div>
          </div>

          <div className="sidebar-section" style={{ marginTop: "1rem" }}>
            <h2>Operators ({lobby.players.length}/4)</h2>
            <ul className="alarm-list">
              {lobby.players.map(p => (
                <li key={p.id} className={`alarm ${p.isReady ? "alarm--quiet" : "alarm--orange"}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>
                      {p.name} {p.id === myPlayerId ? "(You)" : ""} {p.isHost ? "👑" : ""}
                    </strong>
                    <span className={`status-chip ${p.isReady ? "status-chip--success" : "status-chip--warning"}`}>
                      {p.isReady ? "Ready" : "Standby"}
                    </span>
                  </div>
                </li>
              ))}
              {lobby.players.length === 0 && <li className="alarm alarm--quiet">Waiting for operators...</li>}
            </ul>
          </div>

          <div className="sidebar-section" style={{ marginTop: "1rem" }}>
            <h2>Your Assigned Packs</h2>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
              {myPlayer?.assignedPacks.map(packId => (
                <span key={packId} className="status-chip" style={{ borderColor: "#00d9ff", color: "#00d9ff" }}>
                  {PACK_SHORT_NAMES[packId]}
                </span>
              ))}
              {(!myPlayer?.assignedPacks || myPlayer.assignedPacks.length === 0) && (
                <span style={{ color: "var(--color-text-secondary)" }}>Waiting for host assignment...</span>
              )}
            </div>
          </div>

          <div className="modal-card__actions" style={{ marginTop: "2rem" }}>
            <button 
              type="button"
              className={myPlayer?.isReady ? "is-primary" : ""}
              onClick={() => socket.setReady(!myPlayer?.isReady)}
            >
              {myPlayer?.isReady ? "Cancel Ready" : "Ready Up"}
            </button>
            
            {isHost && (
              <button 
                type="button"
                className="is-primary"
                disabled={!allReady || lobby.players.length === 0} 
                onClick={() => socket.startGame()}
              >
                Start Mission
              </button>
            )}
          </div>
          
          {isHost && !allReady && lobby.players.length > 0 && (
            <p className="empty-state" style={{ marginTop: "0.5rem" }}>
              Waiting for all operators to ready up before starting.
            </p>
          )}
        </section>
      </main>
    );
  }

  // Connection UI
  return (
    <main className="boot-screen">
      <section className="modal-card" style={{ maxWidth: 460 }}>
        <div className="modal-card__header">
          <div>
            <span className="eyebrow">HELM Control Room</span>
            <h2>Multiplayer Connection</h2>
          </div>
        </div>

        {socket.state.phase === "disconnected" && (
          <div className="modal-card__actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="is-primary" style={{ width: "100%" }} onClick={socket.connect}>
              Connect to Server
            </button>
          </div>
        )}
        
        {socket.state.phase === "connecting" && (
          <p className="empty-state">Establishing secure WebSocket connection...</p>
        )}

        {(socket.state.phase === "error" || errorMsg) && (
          <article className="toast toast--critical" style={{ position: "relative", marginTop: "1rem" }}>
            <div>
              <strong>Connection Error</strong>
              <p>{errorMsg || socket.state.error}</p>
            </div>
          </article>
        )}

        {socket.state.phase !== "disconnected" && socket.state.phase !== "connecting" && (
          <div style={{ marginTop: "1.5rem" }}>
            <div className="sidebar-section">
              <label>Operator Name</label>
              <input 
                type="text" 
                value={playerName} 
                onChange={(e) => setPlayerName(e.target.value)} 
                placeholder="Enter callsign..."
                style={{ width: "100%", padding: "0.75rem", background: "#0a0e14", border: "1px solid #1f2937", color: "#e6edf3", borderRadius: "10px", fontFamily: "inherit" }}
              />
            </div>

            <button 
              type="button"
              className="is-primary"
              style={{ width: "100%", marginTop: "1.5rem", marginBottom: "2rem" }} 
              onClick={handleCreate} 
              disabled={creating}
            >
              {creating ? "Creating..." : "Create New Room"}
            </button>

            <div style={{ borderTop: "1px solid #1f2937", paddingTop: "2rem" }}>
              <form onSubmit={handleJoin} className="sidebar-section">
                <label>Join Existing Room</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input 
                    type="text" 
                    value={joinCode} 
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())} 
                    placeholder="6-char code"
                    maxLength={6}
                    style={{ flex: 1, padding: "0.75rem", background: "#0a0e14", border: "1px solid #1f2937", color: "#e6edf3", borderRadius: "10px", fontFamily: "inherit", textTransform: "uppercase" }}
                  />
                  <button type="submit" disabled={joining || joinCode.length !== 6}>
                    {joining ? "Joining..." : "Join"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
