import { spawn } from "node:child_process";

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SpawnResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

// Negative lookbehind on each prefix-style pattern prevents false positives
// like `--ask-for-approval` (where `sk-for-approval` looks like a key match).
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?<![A-Za-z])(sk-ant-[A-Za-z0-9_-]{12,})/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/(?<![A-Za-z])(sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_OPENAI_KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[REDACTED_TOKEN]"],
  [/([A-Z0-9_]*(?:TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^\s]+/gi, "$1[REDACTED]"]
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function runCli(command: string, args: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // On Windows, npm-installed bins are .cmd shims. Node's child_process.spawn()
    // does not auto-resolve PATHEXT without shell: true, so plain `spawn("codex")`
    // returns ENOENT even when `codex.cmd` is on PATH. Use shell on Windows only.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;

    const escalate = (): void => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000).unref();
    };

    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const timer = setTimeout(() => {
      timedOut = true;
      escalate();
    }, timeoutMs);
    timer.unref();

    const onAbort = (): void => {
      if (cancelled) return;
      cancelled = true;
      escalate();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const redacted = redact(chunk);
      if (options.onStdout) options.onStdout(redacted);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      const redacted = redact(chunk);
      if (options.onStderr) options.onStderr(redacted);
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code ?? -1,
        signal,
        stdout: redact(stdout),
        stderr: redact(stderr),
        durationMs: Date.now() - started,
        timedOut,
        cancelled
      });
    });
  });
}
