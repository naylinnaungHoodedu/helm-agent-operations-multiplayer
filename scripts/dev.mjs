import { spawn } from "node:child_process";

const npmCommand = "npm";

const processes = [
  {
    name: "server",
    args: ["run", "dev", "--workspace", "@helm/server"]
  },
  {
    name: "game",
    args: ["run", "dev", "--workspace", "@helm/game", "--", "--host", "127.0.0.1"]
  }
];

let shuttingDown = false;
const children = [];

for (const { name, args } of processes) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npmCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", [npmCommand, ...args].join(" ")]
      : args;

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    shell: false
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev] ${name} exited (${signal ?? code}). Stopping remaining processes.`);
    for (const other of children) {
      if (other !== child && !other.killed) other.kill();
    }
    process.exit(code ?? 0);
  });

  children.push(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
