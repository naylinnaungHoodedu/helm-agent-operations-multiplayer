import { useState } from "react";
import { useMultiplayerSocket } from "./hooks/useMultiplayerSocket";
import SinglePlayerApp from "./SinglePlayerApp";
import { MultiplayerLobby } from "./MultiplayerLobby";
import { MultiplayerGame } from "./MultiplayerGame";

export default function AppRouter() {
  const [mode, setMode] = useState<"menu" | "solo" | "multi">("menu");
  const socket = useMultiplayerSocket();

  if (mode === "menu") {
    return (
      <main className="boot-screen">
        <section className="modal-card" style={{ maxWidth: 500, textAlign: "center" }}>
          <div className="modal-card__header" style={{ justifyContent: "center", borderBottom: "1px solid #1f2937", paddingBottom: "1rem", marginBottom: "1rem" }}>
            <div>
              <span className="eyebrow" style={{ fontSize: "1rem" }}>HELM</span>
              <h2 style={{ fontSize: "2.2rem", margin: "0.5rem 0" }}>Agent Operations</h2>
              <p>Select Operating Mode</p>
            </div>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <button 
              type="button"
              className="is-primary" 
              style={{ padding: "1.2rem", fontSize: "1.1rem" }}
              onClick={() => {
                setMode("multi");
                socket.connect();
              }}
            >
              Multiplayer Control Room
            </button>
            <button 
              type="button"
              style={{ padding: "1.2rem", fontSize: "1.1rem" }}
              onClick={() => setMode("solo")}
            >
              Solo Operations
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "solo") {
    return <SinglePlayerApp />;
  }

  // Multiplayer Mode Routing
  if (socket.state.phase === "ingame") {
    return <MultiplayerGame socket={socket} />;
  }

  if (socket.state.phase === "postgame" && socket.state.gameOver) {
    const { gameOver } = socket.state;
    const isVictory = gameOver.reason === "victory";

    return (
      <main className="boot-screen">
        <section className={`modal-card ${!isVictory ? "catastrophe-card" : ""}`} style={{ maxWidth: 600, textAlign: "center" }}>
          <div className="modal-card__header" style={{ justifyContent: "center" }}>
            <div>
              <span className="eyebrow" style={{ color: isVictory ? "#10f2a0" : "#ff3b5c" }}>
                {isVictory ? "MISSION ACCOMPLISHED" : "SYSTEM FAILURE"}
              </span>
              <h2>{isVictory ? "$1B ARR Reached" : "Trust Collapsed"}</h2>
            </div>
          </div>
          
          <p style={{ margin: "1.5rem 0", fontSize: "1.2rem", lineHeight: 1.6, color: "#e6edf3" }}>
            {gameOver.message}
          </p>
          
          <div className="detail-grid" style={{ marginBottom: "2rem" }}>
            <div className="detail-card">
              <h3>Final ARR</h3>
              <p style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#10f2a0", marginTop: "0.5rem" }}>
                ${(gameOver.finalState.arr / 1000000).toFixed(1)}M
              </p>
            </div>
            <div className="detail-card">
              <h3>Final Trust</h3>
              <p style={{ fontSize: "1.5rem", fontWeight: "bold", color: isVictory ? "#00d9ff" : "#ff3b5c", marginTop: "0.5rem" }}>
                {gameOver.finalState.trust.toFixed(1)}
              </p>
            </div>
          </div>

          <div className="modal-card__actions" style={{ justifyContent: "center" }}>
            <button 
              type="button"
              onClick={() => {
                socket.disconnect();
                setMode("menu");
              }}
            >
              Return to Menu
            </button>
          </div>
        </section>
      </main>
    );
  }

  return <MultiplayerLobby socket={socket} />;
}
