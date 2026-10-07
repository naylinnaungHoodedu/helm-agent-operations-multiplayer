# HELM Agent Operations

HELM Agent Operations is a browser-playable multiplayer control-room simulation built for the Create a Multiplayer Game challenge. Players join a shared room, split responsibility for nine AI operations skill packs, triage real-time approval cards, capture automation policies, and try to scale the company to $1B ARR while preserving operator trust.

## Challenge Fit

- Real-time multiplayer with room codes and 2-4 operators.
- Authoritative Socket.IO server keeps every player's screen in sync.
- Rules are visible in the UI through card severities, pack assignments, alarms, and win/loss states.
- The project can run locally in one command for development and can be deployed as one Docker/Railway web service.

## Tech Stack

- TypeScript monorepo with npm workspaces.
- React, Vite, React Three Fiber, Phaser, PixiJS, Recharts, and Web Audio for the game client.
- Express and Socket.IO for the authoritative multiplayer server.
- Zod-backed content schemas for packs, cards, scenarios, and catastrophic events.
- Vitest for deterministic simulation, runtime guard, policy engine, and content validation tests.

## Project Structure

```text
apps/game        Vite React game client
apps/server      Express and Socket.IO multiplayer server
apps/web         Next.js launcher shell
packages/*       Shared simulation, policy, economy, content, event, and entity packages
content/*        Versioned game content catalogs
tests/*          Unit and integration tests
scripts/*        Multiplayer and browser playtest harnesses
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the multiplayer server and game client together:

```bash
npm run dev
```

Open the game client at:

```text
http://localhost:5173
```

The server health endpoint is:

```text
http://localhost:3001/health
```

## Production Build

```bash
npm run build
npm run start:built --workspace @helm/server
```

After the production server starts, open:

```text
http://localhost:3001
```

## Deployment

The repository includes a `Dockerfile` and `railway.json`. The Docker image builds the game client and server, then serves the compiled game from the Express server on the configured `PORT`.

Railway or a similar container host can deploy the project as a single web service. No separate static frontend host is required for the default deployment path.

## Validation

The current project passes:

```bash
npm run typecheck
npm test
npm run validate:content
npm run build
```

## Gameplay Summary

1. Start multiplayer mode.
2. Create a room or join with a 6-character room code.
3. Ready up and let the host start the mission.
4. Operators triage cards only for their assigned packs.
5. Use policies to automate routine approvals as queue pressure grows.
6. Win by reaching $1B ARR with high trust. Lose if trust collapses or cash runs out.

## Notes

This repository intentionally excludes generated folders such as `node_modules`, `.next`, and build `dist` outputs. Recreate them with `npm install` and `npm run build`.
