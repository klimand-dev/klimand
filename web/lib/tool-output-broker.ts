// In-process broker for full CLI stdout/stderr keyed by tool call id.
// IMPORTANT: only the broker — never the agent's tool-return value — carries
// the full transcript. This isolates display data from model context to keep
// inference costs bounded.

export interface PendingApproval {
  prompt: string;
  provider: "claude" | "codex";
  threadId?: string;
}

export interface ApprovalDecision {
  decision: "approve" | "reject";
  editedPrompt?: string;
}

interface ToolOutputEntry {
  stdout: string;
  stderr: string;
  complete: boolean;
  cancelled?: boolean;
  exitCode?: number;
  durationMs?: number;
  command?: string;
  cwd?: string;
  provider?: "claude" | "codex";
  aborter?: () => void;
  pendingApproval?: PendingApproval;
  approvalResolver?: (decision: ApprovalDecision) => void;
  updatedAt: number;
}

// Pin the store on globalThis so Next.js dev-mode module hot-reloads don't
// drop chunks: the tool-execute path and the /api/tool-output route handler
// must share the same Map instance even if their module records get
// re-evaluated independently.
const GLOBAL_KEY = "__klimand_tool_output_broker__";
const globalSlot = globalThis as unknown as { [k: string]: Map<string, ToolOutputEntry> | undefined };
const store: Map<string, ToolOutputEntry> = globalSlot[GLOBAL_KEY] ?? new Map<string, ToolOutputEntry>();
globalSlot[GLOBAL_KEY] = store;

const MAX_ENTRIES = 200;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function ensure(toolCallId: string): ToolOutputEntry {
  let entry = store.get(toolCallId);
  if (!entry) {
    entry = { stdout: "", stderr: "", complete: false, updatedAt: Date.now() };
    store.set(toolCallId, entry);
    pruneIfNeeded();
  }
  return entry;
}

function pruneIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const sorted = [...store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const removeCount = store.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    store.delete(sorted[i]![0]);
  }
}

function clamp(s: string): string {
  if (s.length <= MAX_TEXT_BYTES) return s;
  return s.slice(-MAX_TEXT_BYTES);
}

export function appendStdout(toolCallId: string, chunk: string): void {
  const entry = ensure(toolCallId);
  entry.stdout = clamp(entry.stdout + chunk);
  entry.updatedAt = Date.now();
}

export function appendStderr(toolCallId: string, chunk: string): void {
  const entry = ensure(toolCallId);
  entry.stderr = clamp(entry.stderr + chunk);
  entry.updatedAt = Date.now();
}

export function markStarted(
  toolCallId: string,
  meta: { provider: "claude" | "codex"; command: string; cwd: string }
): void {
  const entry = ensure(toolCallId);
  entry.provider = meta.provider;
  entry.command = meta.command;
  entry.cwd = meta.cwd;
  entry.updatedAt = Date.now();
}

export function markComplete(
  toolCallId: string,
  meta: { exitCode: number; durationMs: number; cancelled?: boolean }
): void {
  const entry = ensure(toolCallId);
  entry.complete = true;
  entry.exitCode = meta.exitCode;
  entry.durationMs = meta.durationMs;
  if (meta.cancelled) entry.cancelled = true;
  entry.aborter = undefined;
  entry.updatedAt = Date.now();
}

export function registerAborter(toolCallId: string, fn: () => void): void {
  const entry = ensure(toolCallId);
  entry.aborter = fn;
  entry.updatedAt = Date.now();
}

export function abort(toolCallId: string): boolean {
  const entry = store.get(toolCallId);
  if (!entry || entry.complete || !entry.aborter) return false;
  try {
    entry.aborter();
  } catch {
    /* swallow */
  }
  entry.aborter = undefined;
  entry.updatedAt = Date.now();
  return true;
}

export function requestApproval(
  toolCallId: string,
  approval: PendingApproval
): Promise<ApprovalDecision> {
  const entry = ensure(toolCallId);
  entry.pendingApproval = approval;
  entry.updatedAt = Date.now();
  return new Promise<ApprovalDecision>((resolve) => {
    entry.approvalResolver = (decision) => {
      entry.pendingApproval = undefined;
      entry.approvalResolver = undefined;
      entry.updatedAt = Date.now();
      resolve(decision);
    };
  });
}

export function resolveApproval(toolCallId: string, decision: ApprovalDecision): boolean {
  const entry = store.get(toolCallId);
  if (!entry || !entry.approvalResolver) return false;
  entry.approvalResolver(decision);
  return true;
}

export interface ToolOutputSnapshot {
  stdout: string;
  stderr: string;
  complete: boolean;
  cancelled: boolean;
  exitCode: number | null;
  durationMs: number | null;
  command: string | null;
  cwd: string | null;
  provider: "claude" | "codex" | null;
  pendingApproval: PendingApproval | null;
}

export function getSnapshot(toolCallId: string): ToolOutputSnapshot | null {
  const entry = store.get(toolCallId);
  if (!entry) return null;
  return {
    stdout: entry.stdout,
    stderr: entry.stderr,
    complete: entry.complete,
    cancelled: entry.cancelled ?? false,
    exitCode: entry.exitCode ?? null,
    durationMs: entry.durationMs ?? null,
    command: entry.command ?? null,
    cwd: entry.cwd ?? null,
    provider: entry.provider ?? null,
    pendingApproval: entry.pendingApproval ?? null
  };
}
