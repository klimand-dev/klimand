import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

// On Windows, fs.rename can transiently fail with EPERM / EBUSY / EACCES when
// the target file is held open by an antivirus scanner, a file watcher (e.g.
// Next.js dev-mode HMR), or an indexer. The bug is well-documented:
//   https://github.com/nodejs/node/issues/4337
//   https://github.com/isaacs/node-graceful-fs
//
// Without a retry, a single transient collision under the file watcher leaves
// the destination unchanged and a stranded `.tmp-*` file behind. In Klimand
// this caused the goal runner's outer catch to swallow the rename failure and
// mark the goal as "escalated" even though the underlying CLI work succeeded.
//
// Bounded retry with linear backoff and jitter is the standard mitigation.
// We also clean up the temp file on final failure so successive writes don't
// accumulate orphans on disk.

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOENT"]);
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && RETRY_CODES.has(code);
}

/**
 * Atomically write `content` to `file` via a temp-then-rename, retrying the
 * rename a bounded number of times on transient Windows file-lock errors.
 * Creates the parent directory if missing.
 */
export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, "utf8");
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break;
      const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
      await sleep(BASE_DELAY_MS * (attempt + 1) + jitter);
    }
  }
  // Surface failure — but don't leave the orphan behind to mislead future debugging.
  try {
    await unlink(tmp);
  } catch {
    /* tmp already gone or we don't have permission — either way, give up cleanly */
  }
  throw lastErr ?? new Error(`atomicWrite: rename failed after ${MAX_RETRIES} retries`);
}
