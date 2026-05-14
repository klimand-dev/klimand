# Klimand

> **One chat. Two agents. Real project awareness.**
> A local orchestrator UI that drives **Claude Code** and **Codex** from a single chat-shaped interface — and actually reads your `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, slash commands, subagents, skills, and hooks before deciding what to do.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## What it is

Klimand is the orchestrator that already knows your project. You point it at a folder, it scans the per-CLI configuration both tools care about (`.claude/`, `.codex/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, hooks, slash commands, subagents, skills), and feeds that digest into a routing model (gpt-5 family) that picks Claude Code or Codex per turn.

A thread-shaped UI keeps the conversation, branded terminal cards show each CLI session live, and a project view exposes what the orchestrator actually sees.

## What's new (May 2026)

- **Auto-discovery + dropdown picker** with approve/remove — no more typing absolute paths
- **Project view** — see exactly what `CLAUDE.md`, slash commands, subagents, skills, MCP servers, and hooks the orchestrator has loaded
- **Project registry** persisted across machines (sync coming in Pro)
- **Scheduled runs** — fire-and-forget agent runs on a cron
- **Project-aware orchestrator prompts** — every chat request gets a digest of your project's config

## 90-second quickstart

```bash
npx klimand
```

That's it. On first launch:

1. Klimand scans your home directory and common dev folders (`~/Documents`, `~/code`, `~/projects`, the parent of `pwd`).
2. A welcome screen lists every project it found. Approve the ones you want in your workspace.
3. You're dropped into a chat thread already bound to your first project. Type a goal. The orchestrator picks Claude Code or Codex, runs it, and streams the session live.

No API key paste required for the CLI runs themselves — Claude Code and Codex use their own auth. The orchestrator's router needs an OpenAI key; paste it in **Settings → BYOK** the first time you send a message (or set `OPENAI_API_KEY` in your environment).

## Comparison

| If you currently use… | Klimand adds |
|---|---|
| `claude` CLI alone | Multi-CLI routing, thread history, project view, scheduling, MCP awareness |
| `codex` CLI alone | Same — plus Claude Code as a peer when the task calls for it |
| Cursor / Cline / Roo / aider | A CLI-agnostic orchestrator that lives outside your editor, with project-config-aware routing and persistent threads |
| Nothing yet | A chat-shaped front door for both CLIs that actually reads the project's intent |

## Local development

```bash
git clone https://github.com/<your-org>/klimand.git
cd klimand/web
npm install
npm run dev
```

Open `http://localhost:3000`. Same first-run flow as the `npx` entry.

### Environment variables

| Name | Purpose | Default |
|------|---------|---------|
| `OPENAI_API_KEY` | Required for the orchestrator/router | — (also settable via the in-app BYOK panel) |
| `OPENAI_AGENT_MODEL` | Model id passed to the Agents SDK | `gpt-5.4-mini` |
| `KLIMAND_STATE_DIR` | Where threads + audit log live | `<repo>/.klimand` |
| `KLIMAND_WORKSPACE` | Default workspace path for tool calls | `process.cwd()` |

## Headless mode (legacy)

The original 4-role `plan → execute → review → repair` headless CLI still ships in the same repo:

```bash
npm install
npm run build
node dist/src/cli.js preflight
node dist/src/cli.js start "Implement the next task" --workspace /path/to/repo
node dist/src/cli.js run --goal <goal-id> --watch
node dist/src/cli.js status <goal-id>
node dist/src/cli.js dashboard
```

Both surfaces share the same `<stateDir>/` and audit log. See [docs/headless.md](docs/headless.md) for the full headless flow, audit log shape, and dashboard hotkeys.

## How project awareness works

Every time you send a message in a thread bound to a project, Klimand:

1. Scans the project for markers: `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.mcp.json`, `package.json`, `.git`.
2. Reads (with a budget) the contents of `CLAUDE.md`, `AGENTS.md`, slash commands, subagents, skills, MCP server configs, and hooks.
3. Compiles a compact digest (~3 KB) and injects it into the orchestrator's system prompt.
4. The orchestrator routes between Claude Code and Codex with that digest in hand.

The digest is cached per-project with a fingerprint of every file it touched — when nothing has changed it's served from memory in <1 ms. You can see the live digest in the **Project View** (click the project name in the dropdown).

## Roadmap

- **Phase A (landed):** OSS structure, zero-install entry, project discovery + welcome flow, MIT/Apache prep.
- **Phase B (landed):** GitHub PR / Linear issue ingest with "from URL" button, BYOK panel for LLM + integration keys.
- **Phase C–D (code complete, not yet deployed):** GitHub-backed cross-device sync, hosted scheduling, Web Push notifications, hosted LLM gateway. The local-app side ships in this repo; the hosted side lives in `cloud/worker/` and requires a Cloudflare + Stripe account to deploy.

> **Note:** No hosted Pro service is currently running. The `/license` page and Pro toggles are wired but inert until someone deploys `cloud/worker/` and configures `KLIMAND_CLOUD_BASE`. The free local app works fully on its own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues, PRs, and Discussions all welcome.

## License

Apache-2.0. See [LICENSE](LICENSE).
