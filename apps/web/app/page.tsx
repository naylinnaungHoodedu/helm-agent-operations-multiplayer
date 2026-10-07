import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { parsePackCatalog } from "@helm/content-schema";

const loadPackCatalog = async () => {
  const filePath = path.join(process.cwd(), "..", "..", "content", "packs", "packs.v1.json");
  const raw = await readFile(filePath, "utf8");
  return parsePackCatalog(JSON.parse(raw)).packs;
};

export default async function HomePage() {
  const packs = await loadPackCatalog();

  return (
    <main className="page-grid">
      <section className="hero">
        <div>
          <span className="web-eyebrow">Public demo launcher</span>
          <h1>Run the nine-pack HELM showcase from a launcher shell that stays separate from the simulation runtime.</h1>
          <p>
            HELM is a deterministic local-first simulation about policies, approvals, trust, and catastrophic
            operational failure across nine agentic business verticals. The launcher lives in Next, while the
            simulation itself runs in the embedded Vite client.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/play" className="cta">
            Launch public demo
          </Link>
          <span>The `/play` surface opens the public-demo scenario by default with staged unlock pacing.</span>
        </div>
      </section>

      <section className="pack-overview">
        <h2>Nine-pack roadmap</h2>
        <div className="pack-grid">
          {packs.map((pack) => (
            <article key={pack.id} className="pack-card">
              <header>
                <strong>{pack.shortName}</strong>
                <span>Phase {pack.phase}</span>
              </header>
              <h3>{pack.name}</h3>
              <p>{pack.keyMechanic}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
