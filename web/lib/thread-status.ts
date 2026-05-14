import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { listThreads } from "./threads";
import { summarizeThread } from "./tool-output-broker";

// Per-thread status sidecar: small JSON file living next to the thread JSON
// at `.klimand/threads/<id>.status.json`. Tracks turn-anchored timestamps that
// must survive page reloads (and the LRU eviction of the in-memory broker).
//
// Live fields like "is currently running" come from the broker, not the
// sidecar — those are bound to the server process lifetime anyway. The
// sidecar only persists the boundary facts: when the current turn started
// (so a row-level live timer can resume after reload) and how long the last
// settled turn took (so the row shows a "ran 3:42" badge after completion).

const ThreadStatusSidecarSchema = z.object({
  currentTurnStartedAt: z.number().nullable().optional(),
  lastTurnDurationMs: z.number().nullable().optional(),
  lastTurnEndedAt: z.number().nullable().optional()
});

export type ThreadStatusSidecar = z.infer<typeof ThreadStatusSidecarSchema>;

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

function threadsDir(): string {
  return path.join(stateDir(), "threads");
}

function statusFile(id: string): string {
  return path.join(threadsDir(), `${id}.status.json`);
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

export async function readThreadStatusSidecar(id: string): Promise<ThreadStatusSidecar | null> {
  try {
    const raw = await readFile(statusFile(id), "utf8");
    const parsed = ThreadStatusSidecarSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeThreadStatusSidecar(
  id: string,
  patch: Partial<ThreadStatusSidecar>
): Promise<void> {
  const existing = (await readThreadStatusSidecar(id)) ?? {};
  const next: ThreadStatusSidecar = { ...existing, ...patch };
  await atomicWriteJson(statusFile(id), next);
}

export async function markThreadTurnStart(id: string): Promise<void> {
  await writeThreadStatusSidecar(id, { currentTurnStartedAt: Date.now() });
}

export async function markThreadTurnEnd(id: string, startedAt: number | null): Promise<void> {
  const endedAt = Date.now();
  const durationMs = startedAt != null ? endedAt - startedAt : null;
  await writeThreadStatusSidecar(id, {
    currentTurnStartedAt: null,
    lastTurnDurationMs: durationMs,
    lastTurnEndedAt: endedAt
  });
}

export interface ThreadStatus {
  isRunning: boolean;
  pendingApprovalCount: number;
  // Anchor for the row-level live elapsed pill. Prefers the chat route's
  // recorded turn start (sidecar), falls back to the earliest still-running
  // tool call from the broker.
  currentTurnStartedAt: number | null;
  lastTurnDurationMs: number | null;
  lastTurnEndedAt: number | null;
}

export async function getThreadStatus(id: string): Promise<ThreadStatus> {
  const sidecar = await readThreadStatusSidecar(id);
  const broker = summarizeThread(id);
  // Treat sidecar's currentTurnStartedAt as authoritative for the anchor,
  // but use the broker as the source of truth for is-running — server
  // restarts wipe the broker, and badges should clear in that case.
  const isRunning = broker.runningCount > 0;
  const anchor =
    sidecar?.currentTurnStartedAt && isRunning
      ? sidecar.currentTurnStartedAt
      : broker.earliestRunningStartedAt;
  return {
    isRunning,
    pendingApprovalCount: broker.pendingApprovalCount,
    currentTurnStartedAt: anchor ?? null,
    lastTurnDurationMs: sidecar?.lastTurnDurationMs ?? null,
    lastTurnEndedAt: sidecar?.lastTurnEndedAt ?? null
  };
}

export async function getAllThreadStatuses(): Promise<Record<string, ThreadStatus>> {
  const threads = await listThreads();
  const out: Record<string, ThreadStatus> = {};
  await Promise.all(
    threads.map(async (t) => {
      out[t.id] = await getThreadStatus(t.id);
    })
  );
  return out;
}
