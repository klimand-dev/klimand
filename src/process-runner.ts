import { spawn } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { ensureDir, redactSecrets } from "./util.js";
import path from "node:path";

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    stdoutFile?: string;
    stderrFile?: string;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }
): Promise<ProcessResult> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000).unref();
    }, options.timeoutMs);
    timer.unref();

    let stdoutFileReady: Promise<void> | null = null;
    let stderrFileReady: Promise<void> | null = null;
    if (options.stdoutFile) {
      const file = options.stdoutFile;
      stdoutFileReady = ensureDir(path.dirname(file)).then(() => writeFile(file, "", "utf8"));
    }
    if (options.stderrFile) {
      const file = options.stderrFile;
      stderrFileReady = ensureDir(path.dirname(file)).then(() => writeFile(file, "", "utf8"));
    }

    child.on("error", reject);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const redacted = redactSecrets(chunk);
      if (options.onStdout) options.onStdout(redacted);
      if (options.stdoutFile && stdoutFileReady) {
        const file = options.stdoutFile;
        stdoutFileReady = stdoutFileReady.then(() => appendFile(file, redacted, "utf8"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      const redacted = redactSecrets(chunk);
      if (options.onStderr) options.onStderr(redacted);
      if (options.stderrFile && stderrFileReady) {
        const file = options.stderrFile;
        stderrFileReady = stderrFileReady.then(() => appendFile(file, redacted, "utf8"));
      }
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();

    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      const redactedStdout = redactSecrets(stdout);
      const redactedStderr = redactSecrets(stderr);
      try {
        if (stdoutFileReady) await stdoutFileReady;
        if (stderrFileReady) await stderrFileReady;
        if (options.stdoutFile) {
          await writeFile(options.stdoutFile, redactedStdout, "utf8");
        }
        if (options.stderrFile) {
          await writeFile(options.stderrFile, redactedStderr, "utf8");
        }
      } catch (error) {
        reject(error);
        return;
      }
      resolve({
        code,
        signal,
        stdout: redactedStdout,
        stderr: redactedStderr,
        durationMs: Date.now() - started,
        timedOut
      });
    });
  });
}
