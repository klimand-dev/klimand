# Contributing to Klimand

Thanks for your interest. Klimand is open source under Apache-2.0 and welcomes contributions.

## Quick start

```bash
git clone https://github.com/<your-org>/klimand.git
cd klimand/web
npm install
npm run dev
```

Open `http://localhost:3000`. On a fresh install you'll be routed to a welcome screen that runs project discovery and lets you approve the projects you want Klimand to know about.

## Repository layout

- `web/` — the Next.js application (chat UI, orchestrator, project profile, registry, scheduler). Apache-2.0.
- `src/` — the legacy headless CLI (`plan / execute / review / repair` four-role loop). Apache-2.0.
- `cli/` — `npx klimand` zero-install wrapper that starts the web app.
- `samples/` — sample project directories you can point Klimand at if you don't have a real project handy.
- `cloud/` — closed-source. Not in this repo.

## Development

```bash
# typecheck
cd web && npx tsc --noEmit

# run dev server
cd web && npm run dev

# build production bundle
cd web && npm run build
```

## How to file a good bug report

- What did you run? (command, browser, OS)
- What did you expect? What happened?
- Logs from `<state-dir>/audit.jsonl` if relevant (redact paths/secrets first)
- A minimal reproduction is gold

## How to propose a feature

Open a GitHub Discussion before sending a PR for anything larger than a quick fix. A 4–5 sentence sketch ("here's the problem, here's the rough shape of the fix, here's why I think it fits") gets you a fast yes/no.

## What's in scope

- Better project awareness (more markers, smarter digest, better excerpts)
- More CLI backends (any agentic CLI that follows a similar shape)
- More MCP integrations
- Better scheduling, better discovery, better routing

## What's out of scope here (lives in the closed `cloud/`)

- Hosted scheduling, sync, push, billing
- License key issuance + verification
- Hosted LLM gateway

If you have a great idea for the hosted layer, open a Discussion — we'll figure out where it fits.

## Code style

- TypeScript everywhere in `web/`. Strict mode.
- Zod for any data crossing a trust boundary (filesystem, network, user input).
- Atomic writes for any persisted state (`tmp + rename`), see `web/lib/prefs.ts` for the pattern.
- No comments unless they explain *why* (not *what*).
- React: server components by default, mark `"use client"` only when needed.

## Code of Conduct

Be excellent to each other.
