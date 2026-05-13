---
name: goal
description: Drive the AgentChain 4-phase roadmap (cancel → threads → approve → schedule). One phase per invocation; pair with /loop to chain.
---

# AgentChain Roadmap — `/goal`

You are executing one phase of a four-phase enhancement plan for **AgentChain**, the chat-driven orchestrator at `C:\agents\CodexCLIAgent\web` (Next.js App Router, OpenAI Agents SDK on the server, assistant-ui on the client). The orchestrator agent (`gpt-5.4-mini`) delegates every technical task to Claude Code or Codex via the `run_claude_code` / `run_codex` tools.

## The four phases (dependency order)

| Phase | Title | Depends on |
|---|---|---|
| **A** | Cancel / interrupt running CLI calls | — |
| **B** | Multi-thread support (per-thread sandbox + history) | — (do after A to keep diffs small) |
| **C** | Plan / approve gate before tool calls | B |
| **D** | Scheduled prompts (dedicated thread per schedule) | B (and benefits from C) |

## Operating rules

1. **Execute exactly one phase per `/goal` invocation.** Pick the lowest-letter phase not yet shipped. If the user asks for a specific phase, do that one.
2. **After the phase ships**, run `cd web && npm run typecheck` (must be clean), then walk through the manual verification recipe in the browser. Take a screenshot of the key UI state if helpful.
3. **Pause and ask the user before starting the next phase.** Exception: if the user invoked you via `/loop /goal` or otherwise signalled "chain through all of them," continue without asking (per saved memory `feedback_loop_chained_phases`).
4. **Reuse the patterns named below.** Don't invent new abstractions; the codebase already has the shapes you need. Cite file paths in any code you write so reviewers can follow.
5. **No new dependencies unless the phase explicitly calls for one.** (Phase D is the only one that adds a package: `node-cron`.)
6. **Keep the change scope tight.** A bug fix doesn't need surrounding cleanup; a one-shot operation doesn't need a helper. If something is unrelated to the phase, leave it alone.

## Patterns to reuse (with file paths)

- **`globalThis`-pinned in-memory state** (HMR-safe, lost on restart): `web/lib/sandbox.ts`, `web/lib/doctor.ts`.
- **Atomic file write** (`tmp → rename`): `web/lib/prefs.ts` (`setPrefs`).
- **Append-only JSONL log**: `web/lib/audit.ts` (`appendAudit`).
- **Per-callId broker + polling**: `web/lib/tool-output-broker.ts` + `web/app/api/tool-output/[toolCallId]/route.ts` + `web/lib/use-tool-output.ts`.
- **Tool UI card rendering**: `web/components/toolkit.tsx` registers `run_claude_code` / `run_codex` and renders `AgentToolCard` (`web/components/tool-ui/terminal/terminal.tsx`).
- **Side panel layout**: `web/app/page.tsx` (left aside `lg:flex`, mobile drawer via `MobilePanelTrigger`).
- **Tabs / panel structure**: `web/components/agent-profile-panel.tsx`.
- **Agent context plumbing**: `web/lib/bridge.ts` calls `run(agent, input, { stream: true, context: { prefs } })`; tools read it via `readPrefs(runContext)` in `web/lib/cli-tools.ts`.
- **Audit slot for session id**: `goal_id` field is already on the `AuditEvent` shape; today it's hardcoded to `"chat"` in `cli-tools.ts`.

---

## Phase A — Cancel / interrupt running CLI calls

**Goal:** while a Claude or Codex tool call is running, the user can click Cancel on the tool card; the child process gets killed (SIGTERM → SIGKILL escalation) and the card transitions to a `cancelled` state within ~2 s. The orchestrator's follow-up is a one-sentence acknowledgement per the existing strict-delegation rule.

**Files to change:**

- `web/lib/spawn.ts` — extend `SpawnOptions` with `signal?: AbortSignal`. On `signal.aborted` or `signal.addEventListener("abort", …)`, run the existing dual-kill (`SIGTERM`, then `SIGKILL` 5 s later). Return with `cancelled: true` flag on the `SpawnResult` so callers can distinguish from a normal exit.
- `web/lib/tool-output-broker.ts` — add `registerAborter(callId, fn: () => void)` and `abort(callId): boolean`. Store the abort fn alongside the existing per-callId record. Return `false` if the callId isn't registered or is already complete.
- `web/lib/cli-tools.ts` — in `runToolAndSummarize`, before the `runCli` call: `const ac = new AbortController(); registerAborter(id, () => ac.abort());`. Pass `signal: ac.signal` into `runCli`. After completion (success, error, or cancel), clear the aborter. If cancelled, build a summary with `notes: ["cancelled by user"]` and `exit_code: 130` (POSIX convention).
- `web/app/api/tool-output/[toolCallId]/cancel/route.ts` — new file. `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` POST handler calls `abort(callId)`; returns `{ ok: true, cancelled: <boolean> }`.
- `web/components/tool-ui/terminal/terminal.tsx` — add a Cancel button next to the existing Copy button in the header. Show only while `live.complete === false`. On click, POST to `/api/tool-output/[toolCallId]/cancel`. Optimistic UI: dim the button while the request is in-flight; the card will transition to `cancelled` once the next poll picks up `complete: true` with the cancel flag.
- `web/lib/audit.ts` — no shape change needed; `result` field accepts a new value `"cancelled"`. Plumb through in `cli-tools.ts`.

**Manual verification:**

1. `cd web && npm run typecheck` clean.
2. `npm run dev`, open the UI.
3. Send: *"Use Claude to run a 60-second sleep loop and then print done."* When the Claude card is streaming, click Cancel.
4. Within ~2 s the card status should flip to `cancelled` with exit code `130`. The agent's follow-up should be one sentence ("Claude cancelled. Anything else?" or similar).
5. Run `Get-Process claude` (or `tasklist | findstr claude` / `ps -A | grep claude`) — no zombie child process should remain.

---

## Phase B — Multi-thread support

**Goal:** the app supports multiple conversation threads, each with its own sandbox directory and its own message history. Threads persist across server restarts. A left-rail thread list shows them grouped into two sections: **Chats** and **Scheduled** (the Scheduled section will fill in once Phase D ships; for Phase B it can be empty).

**Files to change:**

- **New** `web/lib/threads.ts` — file-backed registry. Record:
  ```ts
  interface Thread {
    id: string;            // uuid or short-id
    title: string;         // editable; default "New chat <date>"
    kind: "chat" | "scheduled";
    scheduleId?: string;   // populated only for kind="scheduled"
    sandbox: string;       // absolute path
    createdAt: string;     // ISO
    lastTouched: string;   // ISO
    messages: unknown[];   // UIMessage[] from assistant-ui/AI SDK
  }
  ```
  Storage layout: one file per thread under `$AGENTCHAIN_STATE_DIR/threads/<id>.json` plus an index `threads/index.json` for fast listing. Use the atomic-write pattern from `prefs.ts`. Exports: `listThreads()`, `getThread(id)`, `createThread({title?, kind, scheduleId?})`, `updateThread(id, partial)`, `appendMessages(id, msgs)`, `deleteThread(id)`.
- `web/lib/sandbox.ts` — replace the single `__agentchain_sandbox__` slot with `Map<string, string>` keyed by `threadId`. Add `getSandboxForThread(threadId)` (creates the dir on first access, stores the path in the thread record so it persists). Keep `rotateSandbox(threadId)` for the SandboxBar button. Keep `getCurrentSandbox()` as a thin wrapper that requires a threadId.
- `web/app/api/chat/route.ts` — accept `threadId` in the request body. If missing, look up or create a default thread (`title: "Default"`, `kind: "chat"`). Pass `threadId` to `runAgentAsUIStream`.
- `web/lib/bridge.ts` — extend `runAgentAsUIStream` to take `threadId`, load that thread's prior messages, prepend them to the incoming messages, and pass `context: { prefs, threadId }`. After the run completes, persist the new messages back via `appendMessages(threadId, …)`. Update `lastTouched`.
- `web/lib/cli-tools.ts` — extend `AgentRunContext` with `threadId`. In `runToolAndSummarize`, call `getSandboxForThread(threadId)`. Replace the hardcoded `goal_id: "chat"` in the two audit events with the threadId.
- `web/components/assistant.tsx` — switch to a thread-aware runtime. Track the current threadId in component state (or via the existing `useChatRuntime` thread support — consult the assistant-ui skill for the current API). Pass `threadId` in the chat request body via the transport.
- **New** `web/components/thread-list.tsx` — left-rail list. Two collapsible sections, "Chats" and "Scheduled". Each row: title (editable on double-click), `lastTouched` relative time, a small status badge for `kind="scheduled"` showing enabled/disabled. Buttons: "New chat" at the top, delete (with confirm) per row. Active thread is highlighted.
- `web/app/page.tsx` — layout becomes: header → SandboxBar → flex row: left aside (thread-list rail + AgentProfilePanel stacked) + Assistant. On mobile, the gear-button drawer should now also include the thread list above the panel.
- `web/components/sandbox-bar.tsx` — show the current thread's sandbox path. Rotate button is scoped to current thread.
- `web/components/mobile-panel-trigger.tsx` — include the thread list inside the drawer.

**Manual verification:**

1. `cd web && npm run typecheck` clean.
2. `npm run dev`.
3. Click "New chat" twice. You should have three threads.
4. In thread #1, ask Codex to write `a.txt` with "thread 1". In thread #2, ask Codex to write `b.txt` with "thread 2". Both should succeed and write to different sandbox directories. Confirm by checking the SandboxBar path differs between threads.
5. Switch between threads — message history restores correctly.
6. Stop the dev server (`Ctrl+C`). Restart with `npm run dev`. All three threads should still be in the list, and each thread's sandbox should still contain its own files.
7. Delete thread #3 — it should disappear from the list and its on-disk record should be gone (`Test-Path` returns False on `$AGENTCHAIN_STATE_DIR/threads/<id>.json`).

---

## Phase C — Plan / approve gate before tool calls

**Goal:** when `prefs.approval === "ask"`, every tool call pauses on an approval card showing the prompt the agent is about to send to the CLI. The user can Approve, Edit-and-Approve, or Reject. Default (`"auto"`) is unchanged behavior. Setting lives in the AgentProfilePanel "CLIs" tab (or a new "Behavior" tab).

**Files to change:**

- `web/lib/prefs.ts` — extend `AgentPrefsSchema` with `approval: z.enum(["auto", "ask"]).default("auto")` at the top level.
- **New** `web/lib/approval-broker.ts` — in-memory store, `globalThis`-pinned. Methods:
  - `request({callId, provider, prompt, threadId}): Promise<{decision: "approve" | "reject"; editedPrompt?: string}>` — creates a record, returns a promise the caller awaits.
  - `resolve(callId, decision, editedPrompt?)` — fulfils the promise and clears the record.
  - `getPending(callId)` — read state for polling.
  - `listPending()` — for debugging.
- `web/lib/cli-tools.ts` — at the existing pre-spawn point (between the `tool_call_started` audit append and the `runCli` call, around lines 90–107), if prefs has `approval: "ask"`: call `markStarted` (so the UI knows about the call), then `await approvalBroker.request(...)`. On `reject`, return a summary with `exit_code: 0, notes: ["rejected by user"], final_text: "User rejected the proposed CLI invocation."` and skip `runCli` entirely. On `approve` with `editedPrompt`, swap the prompt before spawn.
- **New** `web/app/api/approvals/[callId]/route.ts` — GET returns the pending record (or 404), POST `{decision, editedPrompt?}` calls `resolve`.
- UI: install the approval-card Tool UI component (`npx tool-agent "integrate the approval card component for binary confirmation of agent actions"` per the tool-ui skill). In `web/components/tool-ui/terminal/terminal.tsx` (or a wrapper), detect when the live state has `pendingApproval: true` (extend `ToolOutputEntry` to carry this) and render the approval card with the prompt preview + Approve / Edit / Reject buttons. Editing a prompt should open a small textarea in-place; on commit, POST with the new prompt.
- `web/components/agent-profile-panel.tsx` — add a toggle for `prefs.approval` (auto/ask). Wire it through the existing `/api/prefs` PUT.

**Manual verification:**

1. `cd web && npm run typecheck` clean.
2. `npm run dev`. In the panel, set approval to "ask" and save.
3. Send *"Create hi.txt with the word 'hi' inside."* The Codex card should appear in a pending-approval state with the prompt preview visible.
4. Click Edit → change the file content to "hello" → Approve. Codex should run with the edited prompt. Verify `hi.txt` contains `hello`.
5. Send *"Run pytest"* and click Reject. The card should show "rejected by user" with exit 0; the orchestrator's follow-up is one sentence.
6. Flip approval back to "auto"; subsequent runs should not show the gate.

---

## Phase D — Scheduled prompts

**Goal:** the user can create scheduled jobs (cron-style) that run an agent prompt on a schedule. Each schedule owns a dedicated thread (the `kind: "scheduled"` flavour from Phase B); results stream into that thread just like an interactive run. The thread list shows scheduled threads in their own "Scheduled" section.

**Files to change:**

- Add dependency: `node-cron` (`cd web && npm i node-cron && npm i -D @types/node-cron`).
- **New** `web/lib/schedules.ts` — file-backed schedule store. Record:
  ```ts
  interface Schedule {
    id: string;
    name: string;
    cron: string;       // standard 5-field cron
    prompt: string;     // the user-supplied prompt that gets sent into the agent run
    threadId: string;   // points to a kind="scheduled" Thread
    enabled: boolean;
    lastRunAt?: string;
    lastResult?: "ok" | "error" | "cancelled";
    createdAt: string;
  }
  ```
  Storage: `$AGENTCHAIN_STATE_DIR/schedules/index.json` (one file is fine — schedule records are small). Same atomic-write pattern.
- **New** `web/lib/scheduler-init.ts` — one runner, pinned on `globalThis` (HMR-safe). API: `ensureScheduler()`, `reload()`. On init: list all enabled schedules, register each with `node-cron` (`cron.schedule(spec, tickFn, {scheduled: true})`). On tick: load the schedule by id (in case it was disabled), if still enabled call `runAgentForSchedule(schedule)`. On unhandled error: log to audit, update `lastResult: "error"`.
- **New** `web/lib/run-scheduled.ts` (or extend `bridge.ts`) — `runAgentForSchedule(schedule)` invokes the agent with `messages: [{role: "user", content: schedule.prompt}]` and `threadId: schedule.threadId`. Reuses the same `run(agent, input, { context: { prefs, threadId }})` path as the chat route; just doesn't stream over HTTP. After completion, persist the new messages to the thread (so the UI sees them on next load/refresh) and update `lastRunAt` / `lastResult`.
- `web/lib/bridge.ts` — call `ensureScheduler()` at module load so cron survives across HMR. (Or call from `web/app/api/chat/route.ts` on first hit.)
- **New** `web/app/api/schedules/route.ts` — GET list, POST create (auto-creates the dedicated `kind: "scheduled"` thread via `threads.ts` `createThread`). On create/update, call `reload()` on the scheduler.
- **New** `web/app/api/schedules/[id]/route.ts` — GET, PUT, DELETE, POST `{action: "run-now"}` (fires `runAgentForSchedule` immediately).
- UI: new "Scheduled" tab in `web/components/agent-profile-panel.tsx` (4th tab) with a list of schedules + form for new schedule (name, cron, prompt, enabled toggle). Cron validation: client-side via a helper string parse; server-side via `cron.validate(spec)`. Show next-run time using a small cron library or by computing it on the server (return alongside the GET response).
- `web/components/thread-list.tsx` (built in Phase B) — populate the "Scheduled" section with all `kind: "scheduled"` threads; each row shows the schedule's `name`, cron expression, and last-run time/status.

**Manual verification:**

1. `cd web && npm run typecheck` clean.
2. `npm run dev`.
3. In the panel "Scheduled" tab, create: `name: "ts-test"`, `cron: "*/2 * * * *"`, `prompt: "Use Codex to append the current ISO timestamp to time.txt in the sandbox."`, enabled.
4. A new entry appears in the thread list under "Scheduled".
5. Wait ~5 minutes. The dedicated thread should now contain 2–3 tool cards (one per tick) plus the orchestrator's short acknowledgement after each.
6. Disable the schedule. The next 2 minutes pass with no new ticks.
7. Restart the dev server. The schedule is still listed and still disabled. Re-enable it and wait — ticks resume.
8. "Run now" button on a schedule fires an immediate run without waiting for the cron tick.

---

## Out of scope (do NOT do inside `/goal`)

- Cost / usage dashboards (Claude vs Codex spend over time).
- Replay-from-card (re-run a previous tool call's prompt).
- Multi-CLI parallel runs (Claude AND Codex on the same prompt with diff).
- Exposing AgentChain itself as an MCP server.
- Push notifications, toasts, SSE for scheduled-job completion (polling-via-thread is the v1 surface for Phase D).
- Tightening the orchestrator's system prompt further — that work shipped in a prior plan and is verified.

---

## When you finish a phase

1. Confirm `npm run typecheck` clean.
2. Walk the manual verification recipe in the browser.
3. Post a short summary to the user: which phase shipped, files changed, verification result. **Ask before starting the next phase** unless the user already signalled chain-mode (`/loop /goal` or "do all of them").
