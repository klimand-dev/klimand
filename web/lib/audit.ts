import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?<![A-Za-z])(sk-ant-[A-Za-z0-9_-]{12,})/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/(?<![A-Za-z])(sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_OPENAI_KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[REDACTED_TOKEN]"],
  [/([A-Z0-9_]*(?:TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^\s]+/gi, "$1[REDACTED]"]
];

function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export interface AuditEvent {
  ts: string;
  goal_id: string;
  step_id?: string;
  provider?: "claude" | "codex";
  action: string;
  input_sha256?: string;
  output_sha256?: string;
  duration_ms?: number;
  result: "ok" | "error" | "blocked" | "cancelled";
  error_code?: string;
  metadata?: Record<string, unknown>;
}

function resolveStateDir(): string {
  if (process.env.AGENTCHAIN_STATE_DIR) return path.resolve(process.env.AGENTCHAIN_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".agentchain");
}

let stateDirCache: string | null = null;
function stateDir(): string {
  if (stateDirCache) return stateDirCache;
  stateDirCache = resolveStateDir();
  return stateDirCache;
}

function auditFile(): string {
  return path.join(stateDir(), "audit.jsonl");
}

export async function appendAudit(event: AuditEvent): Promise<void> {
  const file = auditFile();
  await mkdir(path.dirname(file), { recursive: true });
  const line = redact(JSON.stringify(event));
  await appendFile(file, `${line}\n`, "utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}
