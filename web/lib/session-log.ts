import { mkdir, readFile, appendFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Durable session log. Each spawned CLI session has its own directory under
 *   <stateDir>/sessions/<sessionId>/
 * containing three files:
 *   - events.jsonl  — one JSON event per line, the canonical history
 *   - stdout.log    — raw stdout (best-effort, not used for orchestration)
 *   - stderr.log    — raw stderr (best-effort)
 *
 * Restart safety: the orchestrator can resume by replaying events.jsonl.
 */

export const SessionEventSchema = z.object({
  ts: z.string(),
  kind: z.enum([
    "session.started",
    "session.stdout",
    "session.stderr",
    "session.exit",
    "session.cancelled",
    "session.error",
    "goal.subtask.dispatched",
    "goal.subtask.completed",
    "goal.completed",
    "goal.escalated"
  ]),
  data: z.record(z.string(), z.unknown()).optional()
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

export function sessionDir(sessionId: string): string {
  return path.join(stateDir(), "sessions", sessionId);
}

function eventsFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "events.jsonl");
}

export function newSessionId(): string {
  return `sess-${randomBytes(6).toString("hex")}`;
}

/**
 * Append an event to the session's events.jsonl. Creates the directory
 * if it doesn't exist. This call is best-effort durable: on a process kill
 * mid-write, the partial line will be discarded by readEvents (which skips
 * unparseable lines).
 */
export async function appendEvent(sessionId: string, event: Omit<SessionEvent, "ts"> & { ts?: string }): Promise<SessionEvent> {
  await mkdir(sessionDir(sessionId), { recursive: true });
  const full: SessionEvent = {
    ts: event.ts ?? new Date().toISOString(),
    kind: event.kind,
    ...(event.data !== undefined ? { data: event.data } : {})
  };
  const line = `${JSON.stringify(full)}\n`;
  await appendFile(eventsFile(sessionId), line, "utf8");
  return full;
}

export async function readEvents(sessionId: string): Promise<SessionEvent[]> {
  try {
    const raw = await readFile(eventsFile(sessionId), "utf8");
    const out: SessionEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = SessionEventSchema.safeParse(JSON.parse(trimmed));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip malformed lines from partial writes */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Lightweight tail: returns events appended after `sinceTs`. Used by the SSE
 * route to resume a stream after a brief disconnect without re-sending the
 * whole history.
 */
export async function readEventsSince(sessionId: string, sinceTs: string): Promise<SessionEvent[]> {
  const all = await readEvents(sessionId);
  return all.filter((e) => e.ts > sinceTs);
}

export async function appendStdout(sessionId: string, chunk: string): Promise<void> {
  await mkdir(sessionDir(sessionId), { recursive: true });
  await appendFile(path.join(sessionDir(sessionId), "stdout.log"), chunk, "utf8");
}

export async function appendStderr(sessionId: string, chunk: string): Promise<void> {
  await mkdir(sessionDir(sessionId), { recursive: true });
  await appendFile(path.join(sessionDir(sessionId), "stderr.log"), chunk, "utf8");
}

/**
 * Write a small index marker so a process that crashes mid-spawn can later be
 * recognised as orphaned. The marker is replaced atomically to avoid partial writes.
 */
export async function writeSessionMeta(sessionId: string, meta: Record<string, unknown>): Promise<void> {
  await mkdir(sessionDir(sessionId), { recursive: true });
  const file = path.join(sessionDir(sessionId), "meta.json");
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
  await rename(tmp, file);
}

export async function readSessionMeta(sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(sessionDir(sessionId), "meta.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
