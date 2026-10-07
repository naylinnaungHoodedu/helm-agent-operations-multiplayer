const GAME_URL = process.env.NEXT_PUBLIC_HELM_GAME_URL ?? "http://localhost:5173";
const GAME_URL_WITH_SCENARIO = `${GAME_URL}${GAME_URL.includes("?") ? "&" : "?"}scenario=public-demo`;

export default function PlayPage() {
  return (
    <main className="play-page">
      <section className="play-copy">
        <span className="web-eyebrow">Embedded launcher</span>
        <h1>Run the public demo control room</h1>
        <p>
          The Next shell keeps release copy and launch surfaces separate from the simulation client. This page embeds
          the Vite game in `public-demo` mode by default so the staged nine-pack showcase opens with the demo pacing
          profile already selected.
        </p>
      </section>

      <section className="play-frame">
        <iframe title="HELM game client" src={GAME_URL_WITH_SCENARIO} />
      </section>
    </main>
  );
}
