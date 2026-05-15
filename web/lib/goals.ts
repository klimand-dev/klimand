import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { atomicWrite } from "./atomic-write";

export const GoalStatusSchema = z.enum([
  "planning",
  "running",
  "paused",
  "succeeded",
  "failed",
  "escalated"
]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const SubTaskStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped"
]);
export type SubTaskStatus = z.infer<typeof SubTaskStatusSchema>;

export const SubTaskSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  description: z.string(),
  prompt: z.string(),
  provider: z.enum(["claude", "codex", "claude-or-codex"]),
  verification: z.string(),
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
  status: SubTaskStatusSchema.default("pending"),
  sessionId: z.string().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  evaluation: z.object({
    verdict: z.enum(["pass", "partial", "fail"]),
    note: z.string().optional()
  }).optional()
});
export type SubTask = z.infer<typeof SubTaskSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  projectPath: z.string().nullable(),
  outcome: z.string(),
  stopCondition: z.string(),
  status: GoalStatusSchema,
  subTasks: z.array(SubTaskSchema),
  decomposedBy: z.string(),
  limits: z.object({
    maxSubTasks: z.number().int().positive().default(20),
    maxWallClockMs: z.number().int().positive().default(4 * 60 * 60 * 1000),
    maxRetriesPerSubTask: z.number().int().nonnegative().default(2)
  }).default(() => ({ maxSubTasks: 20, maxWallClockMs: 4 * 60 * 60 * 1000, maxRetriesPerSubTask: 2 })),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Goal = z.infer<typeof GoalSchema>;

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

function goalsDir(): string {
  return path.join(stateDir(), "goals");
}

function goalFile(id: string): string {
  return path.join(goalsDir(), `${id}.json`);
}

function newId(): string {
  return randomBytes(8).toString("hex");
}

export interface CreateGoalInput {
  threadId: string;
  projectPath: string | null;
  outcome: string;
  stopCondition: string;
  decomposedBy: string;
  subTasks: Array<Omit<SubTask, "id" | "index" | "status" | "sessionId" | "attempts" | "startedAt" | "completedAt" | "evaluation">>;
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const now = new Date().toISOString();
  const goal: Goal = {
    id: newId(),
    threadId: input.threadId,
    projectPath: input.projectPath,
    outcome: input.outcome,
    stopCondition: input.stopCondition,
    decomposedBy: input.decomposedBy,
    status: "planning",
    subTasks: input.subTasks.map((st, i) => ({
      id: newId(),
      index: i,
      description: st.description,
      prompt: st.prompt,
      provider: st.provider,
      verification: st.verification,
      dependsOn: st.dependsOn ?? [],
      status: "pending",
      sessionId: null,
      attempts: 0,
      startedAt: null,
      completedAt: null
    })),
    limits: { maxSubTasks: 20, maxWallClockMs: 4 * 60 * 60 * 1000, maxRetriesPerSubTask: 2 },
    createdAt: now,
    updatedAt: now
  };
  await atomicWrite(goalFile(goal.id), JSON.stringify(goal, null, 2));
  return goal;
}

export async function getGoal(id: string): Promise<Goal | null> {
  try {
    const raw = await readFile(goalFile(id), "utf8");
    const parsed = GoalSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function listGoals(filter?: { threadId?: string; status?: GoalStatus }): Promise<Goal[]> {
  try {
    await mkdir(goalsDir(), { recursive: true });
    const files = await readdir(goalsDir());
    const out: Goal[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(goalsDir(), f), "utf8");
        const parsed = GoalSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) continue;
        const g = parsed.data;
        if (filter?.threadId && g.threadId !== filter.threadId) continue;
        if (filter?.status && g.status !== filter.status) continue;
        out.push(g);
      } catch {
        /* skip unreadable */
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  } catch {
    return [];
  }
}

export async function updateGoal(id: string, patch: Partial<Omit<Goal, "id" | "createdAt">>): Promise<Goal | null> {
  const existing = await getGoal(id);
  if (!existing) return null;
  const merged: Goal = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
  const parsed = GoalSchema.safeParse(merged);
  if (!parsed.success) return null;
  await atomicWrite(goalFile(id), JSON.stringify(parsed.data, null, 2));
  return parsed.data;
}

export async function updateSubTask(
  goalId: string,
  subTaskId: string,
  patch: Partial<Omit<SubTask, "id" | "index">>
): Promise<Goal | null> {
  const goal = await getGoal(goalId);
  if (!goal) return null;
  const updated: Goal = {
    ...goal,
    subTasks: goal.subTasks.map((st) =>
      st.id === subTaskId
        ? { ...st, ...patch, id: st.id, index: st.index }
        : st
    ),
    updatedAt: new Date().toISOString()
  };
  const parsed = GoalSchema.safeParse(updated);
  if (!parsed.success) return null;
  await atomicWrite(goalFile(goalId), JSON.stringify(parsed.data, null, 2));
  return parsed.data;
}

export async function deleteGoal(id: string): Promise<boolean> {
  try {
    await unlink(goalFile(id));
    return true;
  } catch {
    return false;
  }
}
