import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });

copyFileSync(
  path.join(root, "sites", "worker", "index.js"),
  path.join(dist, "server", "index.js")
);
copyFileSync(
  path.join(root, ".openai", "hosting.json"),
  path.join(dist, ".openai", "hosting.json")
);

console.log("Built Sites worker to dist/server/index.js");
