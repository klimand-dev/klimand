import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

export const ScheduleRunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["running", "ok", "error", "cancelled"]),
  summary: z.string().optional(),
  durationMs: z.number().optional()
});
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;

export const ScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  prompt: z.string(),
  threadId: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  lastRunAt: z.string().optional(),
  runs: z.array(ScheduleRunSchema).default([])
});
export type Schedule = z.infer<typeof ScheduleSchema>;

const MAX_RUNS = 50;

function stateDir(): string {
  if (process.env.AGENTCHAIN_STATE_DIR) return path.resolve(process.env.AGENTCHAIN_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".agentchain");
}
function schedulesDir(): string {
  return path.join(stateDir(), "schedules");
}
function scheduleFile(id: string): string {
  return path.join(schedulesDir(), `${id}.json`);
}

function newId(): string {
  return randomBytes(8).toString("hex");
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export async function listSchedules(): Promise<Schedule[]> {
  try {
    const dir = schedulesDir();
    await mkdir(dir, { recursive: true });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const out: Schedule[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(dir, f), "utf8");
        const parsed = ScheduleSchema.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip */
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  } catch {
    return [];
  }
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  try {
    const raw = await readFile(scheduleFile(id), "utf8");
    const parsed = ScheduleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function createSchedule(input: {
  name: string;
  cron: string;
  prompt: string;
  threadId: string;
  enabled?: boolean;
}): Promise<Schedule> {
  const schedule: Schedule = {
    id: newId(),
    name: input.name,
    cron: input.cron,
    prompt: input.prompt,
    threadId: input.threadId,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
    runs: []
  };
  await atomicWrite(scheduleFile(schedule.id), JSON.stringify(schedule, null, 2));
  return schedule;
}

export async function updateSchedule(
  id: string,
  partial: Partial<Pick<Schedule, "name" | "cron" | "prompt" | "enabled">>
): Promise<Schedule | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;
  const updated: Schedule = { ...existing, ...partial };
  await atomicWrite(scheduleFile(id), JSON.stringify(updated, null, 2));
  return updated;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(scheduleFile(id));
    return true;
  } catch {
    return false;
  }
}

export async function appendRun(id: string, run: ScheduleRun): Promise<Schedule | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;
  const runs = [run, ...existing.runs].slice(0, MAX_RUNS);
  const updated: Schedule = {
    ...existing,
    runs,
    lastRunAt: run.startedAt
  };
  await atomicWrite(scheduleFile(id), JSON.stringify(updated, null, 2));
  return updated;
}

export async function updateRun(
  id: string,
  runId: string,
  partial: Partial<ScheduleRun>
): Promise<Schedule | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;
  const runs = existing.runs.map((r) => (r.id === runId ? { ...r, ...partial } : r));
  const updated: Schedule = { ...existing, runs };
  await atomicWrite(scheduleFile(id), JSON.stringify(updated, null, 2));
  return updated;
}

export function newRunId(): string {
  return randomBytes(4).toString("hex");
}
