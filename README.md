# AgentChain

AgentChain is a local orchestrator that lets you drive **Claude Code** and **Codex** as tools from a chat-shaped interface, with a reasoning model (gpt-5 family via OpenAI Agents SDK) as the orchestrator. Reasoning is emitted as plain text (preambles) interleaved with branded terminal cards that show the live CLI sessions running on your machine.

It also retains the original headless workflow: a 4-role `plan → execute → review → repair` orchestrator with its own CLI, TUI, and dashboard. Both surfaces share the same `.agentchain/` directory and audit log.

## Chat UI (default surface)

```bash
# one-time
cd web && npm install
# set your OpenAI key, e.g. in web/.env.local
echo OPENAI_API_KEY=sk-... > web/.env.local
# (optional) override the model
echo OPENAI_AGENT_MODEL=gpt-5-mini >> web/.env.local

# run
cd web && npm run dev
# or, from the project root:
node dist/src/cli.js web
```

Open `http://localhost:3000`. Type a goal. The orchestrator emits short preamble text explaining its plan, calls `run_claude_code` or `run_codex` as tools, and shows each session as a branded terminal card with live stdout.

**Cost note:** the tool's return value to the orchestrator is a small structured summary (`{ final_text, exit_code, duration_ms, ... }`) parsed from the CLI's output. Full transcripts go to the browser via an out-of-band broker — they never enter the model's context window. Each tool call also appends `tool_call_started` / `tool_call_finished` rows to `.agentchain/audit.jsonl` (goal_id `"chat"`).

Environment variables:

| Name | Purpose | Default |
|------|---------|---------|
| `OPENAI_API_KEY` | Required to run the agent | — (chat shows a setup hint if missing) |
| `OPENAI_AGENT_MODEL` | Model id passed to the Agents SDK | `gpt-5.4-mini` |
| `AGENTCHAIN_STATE_DIR` | Where the audit log lives | `<repo>/.agentchain` |
| `AGENTCHAIN_WORKSPACE` | Default workspace path for tool calls | `process.cwd()` of the chat server |

## Headless commands

```bash
npm install
npm run build
node dist/src/cli.js preflight
node dist/src/cli.js start "Implement the next task" --workspace /path/to/repo
node dist/src/cli.js run --goal <goal-id> --watch
node dist/src/cli.js status <goal-id>
node dist/src/cli.js logs --lines 50
node dist/src/cli.js stop <goal-id>
node dist/src/cli.js resume <goal-id>
node dist/src/cli.js dashboard
```

Copy `agentchain.config.example.json` to `agentchain.config.json` to customize commands, timeouts, retries, and state paths.

## The loop

Each goal advances through a fixed four-role rotation:

| Cycle index | Role      | Provider |
|-------------|-----------|----------|
| 0           | `plan`    | Claude   |
| 1           | `execute` | Codex    |
| 2           | `review`  | Claude   |
| 3           | `repair`  | Codex    |
| 4 …         | plan, execute, review, repair (repeat) |

Each step's prompt includes the goal text, the workspace path, the role label, and the prior step's `AgentResult` (so `execute` and `repair` can pick up `next_prompt` from `plan` and `review`).

The goal only transitions to `done` when a `review` or `repair` step returns `status: "done"`. A `done` from `plan` or `execute` is treated as `continue` and the loop proceeds — so the planner or executor cannot prematurely declare victory without verification.

`maxCycles` (default 8) bounds the loop. When exceeded, the goal is marked `blocked`.

## AgentResult contract

Every child step must return a single JSON object matching:

```jsonc
{
  "status": "done|continue|blocked|failed",  // required
  "summary": "human-readable line",          // required, non-empty
  "changes": ["file paths or short notes"],   // optional
  "artifacts": ["file paths"],                 // optional
  "verification": ["test/check ran and passed"], // optional
  "risks": ["caveats, missing auth, etc."],     // optional
  "next_prompt": "concrete next task",         // optional, consumed by execute/repair
  "confidence": 0.0                             // optional, 0..1
}
```

Unknown top-level keys are rejected. `blocked` is the signal for "I need user input or auth"; `failed` is reserved for runtime/tool errors (which trigger the retry path).

## Retries

`maxRetries` (default 1) controls how many times a failing step is re-run before the goal is marked `failed`. Each attempt is logged in the audit trail as `step_retry`, with the attempt index in metadata. The `attempt` column on the `steps` table is updated in place — there is no per-attempt step row.

## Audit log

`<stateDir>/audit.jsonl` is an append-only JSONL stream. One event per line. Each event includes:

- `ts` — ISO timestamp
- `goal_id`, `step_id` (when applicable), `provider`
- `action` — one of `goal_created`, `step_started`, `step_retry`, `step_finished`, `step_failed`
- `input_sha256` / `output_sha256` — hashes of the prompt and result for tamper-evidence
- `duration_ms` — wallclock for the step
- `result` — `ok` | `error` | `blocked`
- `metadata.role`, `metadata.attempt`, `metadata.session_id`

To pull every line for a single goal:

```bash
grep '"goal_id":"goal_XXX"' .agentchain/audit.jsonl
```

Secrets (Anthropic/OpenAI keys, bearer tokens, `*_KEY=`/`*_SECRET=`/`*_TOKEN=` env-style pairs) are redacted at the process boundary before stdout/stderr touch disk or the audit log.

## Safety: bypass mode is the default

The default config runs both providers with all approval prompts disabled:

- `codex exec --json --ask-for-approval never`
- `claude -p --output-format stream-json --permission-mode bypassPermissions`

This gives the chain full automation inside the workspace — and full latitude to do anything in that workspace. `preflight` emits a `warn` row when either bypass flag is detected so you have a visible reminder.

To require approvals, remove `--ask-for-approval never` from `providers.codex.args` and `--permission-mode bypassPermissions` from `providers.claude.args` in your config. The preflight row will downgrade to `ok`.

## Dashboard (TUI)

`agentchain dashboard` opens a live in-terminal view of all goals. Built with [Ink](https://github.com/vadimdemedes/ink) and [`@assistant-ui/react-ink`](https://www.assistant-ui.com/docs/ink).

Two-pane layout:
- **Left:** scrollable goals list with status and cycle count
- **Right:** the selected goal — prompt, full step timeline (provider/role/status), and a live tail of the currently running step's stdout

Hotkeys (v1):

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection |
| `r` | Resume the selected goal (when `blocked` or `stopped`) |
| `s` | Stop the selected goal (when `active`) |
| `q` / `Ctrl-C` | Quit |

**Workflow:** the dashboard is **read-mostly** in v1. Drive runs from a second terminal:

```powershell
# terminal A
node dist/src/cli.js dashboard

# terminal B
node dist/src/cli.js start "demo goal" --workspace C:\tmp\demo
node dist/src/cli.js run --goal <id> --watch
```

The dashboard polls SQLite (250 ms) and watches `runs/<goalId>/cycle-N-.../stdout.log` for live output — so cross-process state still streams to the TUI without an IPC layer.

The Phase 2 desktop app (Tauri + assistant-ui DOM) reuses the same adapter (`src/ink/adapter.ts`), state store, and step-log files.

## Web dashboard (Phase 2)

A browser dashboard lives in `web/` and is served by a small HTTP/SSE bridge added to the CLI. It reads the same `.agentchain/` directory as the TUI and updates in real time.

### Run it

```powershell
# terminal A — start the HTTP/SSE bridge
node dist/src/cli.js serve --port 7878

# terminal B — start the Vite dev server (one-time: cd web && npm install)
cd web
npm run dev          # opens http://localhost:5173, proxies /api and /events to :7878

# terminal C — drive a goal
node dist/src/cli.js start "demo goal" --workspace C:\tmp\agentchain-smoke
node dist/src/cli.js run --goal <id> --watch
```

For a production build:

```powershell
cd web
npm run build        # outputs web/dist/
```

### What the bridge exposes

| Route | Method | Returns |
|-------|--------|---------|
| `/api/goals` | GET | array of `GoalThreadView` |
| `/api/goals/:id` | GET | single `GoalThreadView` or 404 |
| `/api/goals/:id/status` | POST | `{ status: "active" \| "stopped" }` → 204 |
| `/api/logs/:goalId/:stepId` | GET | text of `stdout.log` for the step |
| `/events` | GET (SSE) | typed events: `goal_created`, `goal_status`, `step_started`, `step_finished`, `step_failed`, `step_chunk` |

The SSE stream merges two sources:
- **In-process events** from this `serve` process's `Orchestrator.events` emitter (fires immediately when goals run in the same process).
- **Cross-process events** synthesized by tailing `audit.jsonl` and polling the goals table — so a `run` happening in a separate terminal still updates the dashboard.

CORS is allow-listed for `http://localhost:5173` and `http://127.0.0.1:5173`.

### Future: Tauri shell

Wrapping `web/` in [Tauri](https://tauri.app/) (Rust shell, ~3 MB binary, system webview) yields a native window without re-implementing anything. The same HTTP server is the backend; the Tauri shell just opens the local URL. That packaging step is deferred — the browser dashboard is the v1 deliverable.

## Status semantics

| Status     | Meaning |
|------------|---------|
| `active`   | Goal is in flight; next `tick` will advance it |
| `done`     | A `review` or `repair` step returned `done` |
| `blocked`  | A step returned `blocked` (missing auth, user input needed, etc.) |
| `failed`   | A step failed and retries are exhausted |
| `stopped`  | Operator stopped the goal via `stop` |

## Known limitations

- **No per-goal concurrency lock.** Two concurrent `run --goal <id>` invocations against the same state dir will both tick the same goal. SQLite serializes writes but the orchestrator does not claim a goal before mutating it. Don't run two operators against the same `.agentchain` dir.
- **Session-ID extraction is heuristic.** It scans stream-json for `session_id`/`thread_id`/`conversation_id`/`uuid`. CLI version bumps may silently drop linkage.

## 0.2.0 migration

State schema changed (the unused `recipe` column was dropped, INSERTs are now named-column). If you used 0.1.0, delete your `.agentchain` directory before running 0.2.0 — the old `goals` table has `recipe NOT NULL` and will reject new INSERTs.

## Notes

- Codex is run through `codex exec`.
- Claude is run through `claude -p`.
- Provider auth stays inside the user's installed CLI tools — AgentChain never sees API keys.
- Zero runtime dependencies; SQLite is used via the built-in `node:sqlite` module (Node ≥ 22.5).
