import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { KlimandConfig, AgentResult, ProviderName, ProviderRun, Step } from "./types.js";
import { ensureDir, writeJson } from "./util.js";
import { runProcess } from "./process-runner.js";

export const agentResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary"],
  properties: {
    status: { enum: ["done", "continue", "blocked", "failed"] },
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    artifacts: { type: "array", items: { type: "string" } },
    verification: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    next_prompt: { type: "string" },
    confidence: { type: "number" }
  }
};

export interface ProviderRunOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export async function runProvider(
  config: KlimandConfig,
  step: Step,
  workspace: string,
  hooks: ProviderRunOptions = {}
): Promise<ProviderRun> {
  if (step.provider === "codex") return runCodex(config, step, workspace, hooks);
  return runClaude(config, step, workspace, hooks);
}

async function runCodex(config: KlimandConfig, step: Step, workspace: string, hooks: ProviderRunOptions): Promise<ProviderRun> {
  const provider = config.providers.codex;
  const out = await prepareArtifacts(step);
  const args = [
    ...provider.args,
    "--skip-git-repo-check",
    "--output-schema",
    out.schema,
    "-o",
    out.final,
    "-C",
    workspace,
    "-"
  ];
  const proc = await runProcess(provider.command, args, {
    cwd: workspace,
    input: step.prompt,
    timeoutMs: config.stepTimeoutMs,
    env: provider.env,
    stdoutFile: out.stdout,
    stderrFile: out.stderr,
    onStdout: hooks.onStdout,
    onStderr: hooks.onStderr
  });
  if (proc.code !== 0) {
    throw new Error(`codex exited ${proc.code ?? proc.signal}: ${proc.stderr || proc.stdout}`);
  }
  return {
    result: await readAgentResult(out.final, proc.stdout),
    sessionId: extractSessionId("codex", proc.stdout),
    rawOutput: proc.stdout
  };
}

async function runClaude(config: KlimandConfig, step: Step, workspace: string, hooks: ProviderRunOptions): Promise<ProviderRun> {
  const provider = config.providers.claude;
  const out = await prepareArtifacts(step);
  const args = [...provider.args, "--json-schema", out.schema];
  const proc = await runProcess(provider.command, args, {
    cwd: workspace,
    input: step.prompt,
    timeoutMs: config.stepTimeoutMs,
    env: provider.env,
    stdoutFile: out.stdout,
    stderrFile: out.stderr,
    onStdout: hooks.onStdout,
    onStderr: hooks.onStderr
  });
  if (proc.code !== 0) {
    throw new Error(`claude exited ${proc.code ?? proc.signal}: ${proc.stderr || proc.stdout}`);
  }
  const result = await parseClaudeResult(proc.stdout);
  await writeJson(out.final, result);
  return {
    result,
    sessionId: extractSessionId("claude", proc.stdout),
    rawOutput: proc.stdout
  };
}

async function prepareArtifacts(step: Step): Promise<{ schema: string; final: string; stdout: string; stderr: string }> {
  await ensureDir(step.artifactsDir);
  const schema = path.join(step.artifactsDir, "agent-result.schema.json");
  const final = path.join(step.artifactsDir, "final.json");
  const stdout = path.join(step.artifactsDir, "stdout.log");
  const stderr = path.join(step.artifactsDir, "stderr.log");
  await writeFile(schema, `${JSON.stringify(agentResultSchema, null, 2)}\n`, "utf8");
  return { schema, final, stdout, stderr };
}

async function readAgentResult(finalFile: string, stdout: string): Promise<AgentResult> {
  try {
    return validateAgentResult(JSON.parse(await readFile(finalFile, "utf8")));
  } catch {
    return parseJsonFromText(stdout);
  }
}

async function parseClaudeResult(stdout: string): Promise<AgentResult> {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of [...lines].reverse()) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const candidate = event.result ?? event.message ?? event.content ?? event;
      if (typeof candidate === "string") return parseJsonFromText(candidate);
      if (candidate && typeof candidate === "object") {
        try {
          return validateAgentResult(candidate);
        } catch {
          const text = JSON.stringify(candidate);
          return parseJsonFromText(text);
        }
      }
    } catch {
      continue;
    }
  }
  return parseJsonFromText(stdout);
}

function parseJsonFromText(text: string): AgentResult {
  const trimmed = text.trim();
  try {
    return validateAgentResult(JSON.parse(trimmed));
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("provider output did not contain an AgentResult JSON object");
    return validateAgentResult(JSON.parse(match[0]));
  }
}

const ALLOWED_RESULT_KEYS = new Set([
  "status",
  "summary",
  "changes",
  "artifacts",
  "verification",
  "risks",
  "next_prompt",
  "confidence"
]);

function validateAgentResult(value: unknown): AgentResult {
  if (!value || typeof value !== "object") throw new Error("AgentResult must be an object");
  const result = value as Partial<AgentResult>;
  if (!["done", "continue", "blocked", "failed"].includes(String(result.status))) {
    throw new Error("AgentResult.status must be done, continue, blocked, or failed");
  }
  if (typeof result.summary !== "string" || result.summary.length === 0) {
    throw new Error("AgentResult.summary must be a non-empty string");
  }
  for (const key of Object.keys(result)) {
    if (!ALLOWED_RESULT_KEYS.has(key)) {
      throw new Error(`AgentResult contains unknown key: ${key}`);
    }
  }
  return result as AgentResult;
}

// Heuristic: the key set below isn't a documented contract of either CLI;
// it reflects observed stream-json output. A CLI version bump may silently lose linkage.
function extractSessionId(provider: ProviderName, stdout: string): string | null {
  const keys = provider === "codex" ? ["session_id", "thread_id", "conversation_id"] : ["session_id", "uuid"];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      for (const key of keys) {
        if (typeof event[key] === "string") return event[key];
      }
    } catch {
      continue;
    }
  }
  return null;
}
