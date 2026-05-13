import { tool } from "@openai/agents";
import { z } from "zod";
import { runCli } from "./spawn";
import {
  appendStdout,
  appendStderr,
  markStarted,
  markComplete,
  registerAborter,
  requestApproval
} from "./tool-output-broker";
import { summarize, type AgentSummary } from "./result-extractor";
import { appendAudit, nowIso, sha256 } from "./audit";
import { getCurrentSandbox, getSandboxForThread } from "./sandbox";
import type { AgentPrefs } from "./prefs";

const TIMEOUT_MS = 30 * 60 * 1000;

export interface AgentRunContext {
  prefs: AgentPrefs;
  threadId?: string;
  projectPath?: string;
}

function tokenizeArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out.filter((s) => s.length > 0);
}

function readPrefs(runContext: unknown): AgentPrefs | undefined {
  if (!runContext || typeof runContext !== "object") return undefined;
  const ctx = (runContext as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return undefined;
  const prefs = (ctx as { prefs?: unknown }).prefs;
  if (!prefs || typeof prefs !== "object") return undefined;
  return prefs as AgentPrefs;
}

function readThreadId(runContext: unknown): string | undefined {
  if (!runContext || typeof runContext !== "object") return undefined;
  const ctx = (runContext as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return undefined;
  const threadId = (ctx as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : undefined;
}

function readProjectPath(runContext: unknown): string | undefined {
  if (!runContext || typeof runContext !== "object") return undefined;
  const ctx = (runContext as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return undefined;
  const projectPath = (ctx as { projectPath?: unknown }).projectPath;
  return typeof projectPath === "string" && projectPath.length > 0 ? projectPath : undefined;
}

function claudeArgs(prefs: AgentPrefs | undefined): string[] {
  const args = ["-p", "--output-format", "stream-json"];
  const permission = prefs?.claude.permissionMode ?? "bypassPermissions";
  args.push("--permission-mode", permission);
  if (prefs?.claude.model) args.push("--model", prefs.claude.model);
  args.push(...tokenizeArgs(prefs?.claude.extraArgs));
  return args;
}

function codexArgs(workspace: string, prefs: AgentPrefs | undefined): string[] {
  const sandboxMode = prefs?.codex.sandboxMode ?? "workspace-write";
  const args = ["exec", "--json", "--sandbox", sandboxMode, "--skip-git-repo-check"];
  if (prefs?.codex.model) args.push("--model", prefs.codex.model);
  args.push(...tokenizeArgs(prefs?.codex.extraArgs));
  args.push("-C", workspace, "-");
  return args;
}

interface ToolCallDetailsLike {
  toolCall?: { callId?: string };
}

function shortPromptLabel(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}…`;
}

function callId(details: ToolCallDetailsLike | undefined): string | null {
  return details?.toolCall?.callId ?? null;
}

interface ToolRunSpec {
  provider: "claude" | "codex";
  prompt: string;
  requestedWorkspace: string;
  threadId?: string;
  projectPath?: string;
  approval: "auto" | "ask";
  details: ToolCallDetailsLike | undefined;
  buildCommand: (workspace: string, prompt: string) => string;
  buildArgv: (workspace: string, prompt: string) => { cmd: string; args: string[] };
}

async function runToolAndSummarize(spec: ToolRunSpec): Promise<AgentSummary> {
  // Resolve cwd: if the thread is pointed at a real project, run there.
  // Otherwise, fall back to the server-controlled sandbox. The original
  // value the model passed is recorded in the audit log either way.
  const sandbox = spec.threadId ? await getSandboxForThread(spec.threadId) : await getCurrentSandbox();
  const workspace = spec.projectPath ?? sandbox;
  const workspaceKind: "project" | "sandbox" = spec.projectPath ? "project" : "sandbox";
  const overridden = spec.requestedWorkspace !== workspace;

  let effectivePrompt = spec.prompt;
  let command = spec.buildCommand(workspace, effectivePrompt);
  let argv = spec.buildArgv(workspace, effectivePrompt);
  const id = callId(spec.details);
  if (id) markStarted(id, { provider: spec.provider, command, cwd: workspace });
  const started = Date.now();

  await appendAudit({
    ts: nowIso(),
    goal_id: spec.threadId ?? "chat",
    step_id: id ?? "anon",
    provider: spec.provider,
    action: "tool_call_started",
    input_sha256: sha256(spec.prompt),
    result: "ok",
    metadata: {
      workspace,
      workspace_kind: workspaceKind,
      prompt_preview: shortPromptLabel(spec.prompt),
      ...(overridden ? { workspace_overridden_from: spec.requestedWorkspace } : {})
    }
  }).catch(() => {});

  // Pre-spawn approval gate. When prefs.approval is "ask", pause and wait for
  // the user to approve / edit / reject via the UI before spawning the CLI.
  if (spec.approval === "ask" && id) {
    const decision = await requestApproval(id, {
      prompt: spec.prompt,
      provider: spec.provider,
      threadId: spec.threadId
    });
    if (decision.decision === "reject") {
      const durationMs = Date.now() - started;
      markComplete(id, { exitCode: 0, durationMs });
      const rejectedSummary: AgentSummary = {
        provider: spec.provider,
        exit_code: 0,
        duration_ms: durationMs,
        final_text: `User rejected the proposed ${spec.provider} invocation.`,
        notes: ["rejected by user"]
      };
      await appendAudit({
        ts: nowIso(),
        goal_id: spec.threadId ?? "chat",
        step_id: id,
        provider: spec.provider,
        action: "tool_call_finished",
        input_sha256: sha256(spec.prompt),
        output_sha256: sha256(rejectedSummary.final_text),
        duration_ms: durationMs,
        result: "blocked",
        metadata: { workspace, exit_code: 0, reason: "user_rejected" }
      }).catch(() => {});
      return rejectedSummary;
    }
    if (decision.editedPrompt && decision.editedPrompt !== spec.prompt) {
      effectivePrompt = decision.editedPrompt;
      command = spec.buildCommand(workspace, effectivePrompt);
      argv = spec.buildArgv(workspace, effectivePrompt);
      markStarted(id, { provider: spec.provider, command, cwd: workspace });
    }
  }

  const abortController = new AbortController();
  if (id) registerAborter(id, () => abortController.abort());

  let summary: AgentSummary;
  let cancelled = false;
  try {
    const result = await runCli(argv.cmd, argv.args, {
      cwd: workspace,
      input: effectivePrompt,
      timeoutMs: TIMEOUT_MS,
      signal: abortController.signal,
      onStdout: id ? (chunk) => appendStdout(id, chunk) : undefined,
      onStderr: id ? (chunk) => appendStderr(id, chunk) : undefined
    });
    cancelled = result.cancelled;
    if (cancelled) {
      const exitCode = 130;
      if (id) markComplete(id, { exitCode, durationMs: result.durationMs, cancelled: true });
      summary = {
        provider: spec.provider,
        exit_code: exitCode,
        duration_ms: result.durationMs,
        final_text: `${spec.provider} run cancelled by user`,
        notes: ["cancelled by user"]
      };
    } else {
      if (id) markComplete(id, { exitCode: result.exitCode, durationMs: result.durationMs });
      summary = summarize(spec.provider, result.stdout, result.stderr, {
        exitCode: result.exitCode,
        durationMs: result.durationMs
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - started;
    if (id) {
      appendStderr(id, `${message}\n`);
      markComplete(id, { exitCode: 1, durationMs });
    }
    summary = {
      provider: spec.provider,
      exit_code: 1,
      duration_ms: durationMs,
      final_text: `Failed to launch ${spec.provider} CLI: ${message}`,
      notes: ["spawn or timeout error before the CLI produced output"]
    };
  }

  await appendAudit({
    ts: nowIso(),
    goal_id: spec.threadId ?? "chat",
    step_id: id ?? "anon",
    provider: spec.provider,
    action: "tool_call_finished",
    input_sha256: sha256(spec.prompt),
    output_sha256: sha256(summary.final_text),
    duration_ms: Date.now() - started,
    result: cancelled ? "cancelled" : summary.exit_code === 0 ? "ok" : "error",
    metadata: {
      workspace,
      workspace_kind: workspaceKind,
      exit_code: summary.exit_code,
      summary_chars: summary.final_text.length
    }
  }).catch(() => {});

  return summary;
}

export const runClaudeCode = tool({
  name: "run_claude_code",
  description:
    "Spawn Claude Code on the user's local machine with a focused prompt. " +
    "Use for high-level reasoning steps: planning, code review, design decisions. " +
    "The workspace argument is server-controlled — pass the literal string 'AUTO'; the server substitutes the sandbox path. " +
    "Files persist across tool calls within the same chat session. " +
    "The return value is a compact summary of Claude's final answer; the full transcript is shown to the user in the chat UI separately.",
  parameters: z.object({
    prompt: z.string().min(1).describe("The instruction for Claude. Self-contained, concrete."),
    workspace: z.string().min(1).describe("Pass 'AUTO' — the server substitutes the sandbox path automatically.")
  }),
  execute: async ({ prompt, workspace }, runContext, details): Promise<AgentSummary> => {
    const prefs = readPrefs(runContext);
    const threadId = readThreadId(runContext);
    const projectPath = readProjectPath(runContext);
    // When operating against a real project, force the approval gate on
    // regardless of pref — the approval card is the user's eject button.
    const approval = projectPath ? "ask" : (prefs?.approval ?? "auto");
    return runToolAndSummarize({
      provider: "claude",
      prompt,
      requestedWorkspace: workspace,
      threadId,
      projectPath,
      approval,
      details: details as ToolCallDetailsLike,
      buildCommand: (_ws, p) => `claude ${claudeArgs(prefs).join(" ")} '${shortPromptLabel(p)}'`,
      buildArgv: () => ({ cmd: "claude", args: claudeArgs(prefs) })
    });
  }
});

export const runCodex = tool({
  name: "run_codex",
  description:
    "Spawn Codex on the user's local machine with a focused prompt. " +
    "Use for execution and implementation: writing/editing files, running tests, applying changes. " +
    "The workspace argument is server-controlled — pass the literal string 'AUTO'; the server substitutes the sandbox path. " +
    "Files persist across tool calls within the same chat session. " +
    "The return value is a compact summary of Codex's final result; the full transcript is shown to the user in the chat UI separately.",
  parameters: z.object({
    prompt: z.string().min(1).describe("The instruction for Codex. Self-contained, concrete."),
    workspace: z.string().min(1).describe("Pass 'AUTO' — the server substitutes the sandbox path automatically.")
  }),
  execute: async ({ prompt, workspace }, runContext, details): Promise<AgentSummary> => {
    const prefs = readPrefs(runContext);
    const threadId = readThreadId(runContext);
    const projectPath = readProjectPath(runContext);
    const approval = projectPath ? "ask" : (prefs?.approval ?? "auto");
    return runToolAndSummarize({
      provider: "codex",
      prompt,
      requestedWorkspace: workspace,
      threadId,
      projectPath,
      approval,
      details: details as ToolCallDetailsLike,
      buildCommand: (ws, p) => `codex ${codexArgs(ws, prefs).join(" ")} <<< '${shortPromptLabel(p)}'`,
      buildArgv: (ws) => ({ cmd: "codex", args: codexArgs(ws, prefs) })
    });
  }
});
