import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getThread, getOrCreateDefaultThread, rotateThreadSandbox } from "./threads";

async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export async function getSandboxForThread(threadId: string): Promise<string> {
  const thread = await getThread(threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  await ensureDir(thread.sandbox);
  return thread.sandbox;
}

export async function getCurrentSandbox(): Promise<string> {
  const thread = await getOrCreateDefaultThread();
  await ensureDir(thread.sandbox);
  return thread.sandbox;
}

export async function rotateSandbox(threadId?: string): Promise<string> {
  const target = threadId ?? (await getOrCreateDefaultThread()).id;
  const updated = await rotateThreadSandbox(target);
  if (!updated) throw new Error(`Thread not found: ${target}`);
  await ensureDir(updated.sandbox);
  return updated.sandbox;
}

export function getSandboxRoot(): string {
  return path.join(os.tmpdir(), "klimand-sandboxes");
}
