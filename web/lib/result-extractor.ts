// Reduce a full CLI transcript to a small structured summary suitable for
// returning to the orchestrator model. Anything larger than this would balloon
// inference costs on subsequent turns.

const MAX_TAIL_BYTES = 4000;
const MAX_TAIL_STDERR_BYTES = 1500;

export interface AgentSummary {
  provider: "claude" | "codex";
  exit_code: number;
  duration_ms: number;
  final_text: string;
  // True when the parser extracted a real assistant message from structured
  // CLI output. False when we fell back to a raw stdout tail — in that case
  // final_text is NDJSON noise and should not be surfaced as markdown.
  final_text_parsed: boolean;
  notes?: string[];
}

interface ClaudeResultLine {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function findClaudeFinalResult(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.startsWith("{")) continue;
    const parsed = safeJsonParse(line);
    if (parsed && typeof parsed === "object" && (parsed as ClaudeResultLine).type === "result") {
      const r = (parsed as ClaudeResultLine).result;
      if (typeof r === "string" && r.length > 0) return r;
    }
  }
  return null;
}

function findCodexFinalText(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  // Codex --json typically ends with a message item carrying the final text.
  // Walk back; pick the last line that looks like an assistant message.
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = safeJsonParse(lines[i]!);
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    const candidate =
      pickString(obj, "text") ??
      pickString(obj, "message") ??
      pickString(obj, "content") ??
      pickNested(obj, ["msg", "text"]) ??
      pickNested(obj, ["message", "content"]);
    if (candidate) return candidate;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNested(obj: Record<string, unknown>, path: string[]): string | null {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" && cur.length > 0 ? cur : null;
}

function tail(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text.trim();
  return `…(truncated, full output available in the terminal card)…\n${text.slice(-maxBytes).trim()}`;
}

export function summarize(
  provider: "claude" | "codex",
  stdout: string,
  stderr: string,
  meta: { exitCode: number; durationMs: number }
): AgentSummary {
  let finalText: string | null = null;
  if (provider === "claude") {
    finalText = findClaudeFinalResult(stdout);
  } else {
    finalText = findCodexFinalText(stdout);
  }

  const notes: string[] = [];
  const parsed = finalText !== null;
  if (!finalText) {
    finalText = tail(stdout.trim() || stderr.trim() || "(no output)", MAX_TAIL_BYTES);
    notes.push("structured-result parsing failed; falling back to stdout tail");
  } else if (finalText.length > MAX_TAIL_BYTES) {
    finalText = tail(finalText, MAX_TAIL_BYTES);
  }

  if (stderr.trim() && meta.exitCode !== 0) {
    notes.push(`stderr tail: ${tail(stderr, MAX_TAIL_STDERR_BYTES)}`);
  }

  return {
    provider,
    exit_code: meta.exitCode,
    duration_ms: meta.durationMs,
    final_text: finalText,
    final_text_parsed: parsed,
    notes: notes.length > 0 ? notes : undefined
  };
}
