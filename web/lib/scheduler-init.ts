import { schedule as cronSchedule, validate as cronValidate, type ScheduledTask } from "node-cron";
import { listSchedules } from "./schedules";
import { runScheduledOnce } from "./run-scheduled";

interface SchedulerState {
  started: boolean;
  tasks: Map<string, ScheduledTask>;
  initPromise?: Promise<void>;
}

const GLOBAL_KEY = "__klimand_scheduler__";
const slot = globalThis as unknown as { [k: string]: SchedulerState | undefined };

function getState(): SchedulerState {
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = { started: false, tasks: new Map() };
  }
  return slot[GLOBAL_KEY]!;
}

async function loadAll(state: SchedulerState): Promise<void> {
  const schedules = await listSchedules();
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!cronValidate(s.cron)) continue;
    if (state.tasks.has(s.id)) continue;
    const task = cronSchedule(s.cron, () => {
      runScheduledOnce(s.id).catch(() => {});
    });
    state.tasks.set(s.id, task);
  }
}

export async function ensureScheduler(): Promise<void> {
  const state = getState();
  if (state.started) return;
  if (state.initPromise) {
    await state.initPromise;
    return;
  }
  state.initPromise = (async () => {
    await loadAll(state);
    state.started = true;
  })();
  await state.initPromise;
}

export async function reloadScheduler(): Promise<void> {
  const state = getState();
  for (const task of state.tasks.values()) {
    try {
      task.stop();
      task.destroy();
    } catch {
      /* swallow */
    }
  }
  state.tasks.clear();
  state.started = false;
  state.initPromise = undefined;
  await ensureScheduler();
}

export function isCronValid(expr: string): boolean {
  return cronValidate(expr);
}
