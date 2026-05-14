import type { Goal, SubTask } from "./goals";
import { updateGoal, updateSubTask } from "./goals";
import type { KlimandSkill, KlimandSkillTrigger } from "./klimand-skills/types";
import { consult, renderConsultedSkills, type ConsultContext } from "./klimand-skills/consult";
import type { KlimandSkillRegistry } from "./klimand-skills/registry";

/**
 * The autonomy loop is intentionally a thin coordinator. It owns:
 *   - "what is the next decision point for this goal?"
 *   - "which skills should I consult here?"
 *   - "apply the chosen action to the persisted goal"
 *
 * It does NOT own:
 *   - the LLM call that decomposes a goal or evaluates a result
 *   - the CLI spawn that runs a sub-task
 *
 * Those are injected via the `TaskAdvisor` interface, so tests can drive the
 * loop deterministically and the real implementation plugs into the existing
 * Klimand chat-side dispatch.
 */

export type DecisionPoint =
  | { kind: "decompose" }
  | { kind: "dispatch"; subTask: SubTask; consultedSkills: KlimandSkill[] }
  | { kind: "awaiting-completion"; subTask: SubTask }
  | { kind: "evaluate"; subTask: SubTask; consultedSkills: KlimandSkill[] }
  | { kind: "completion-check"; consultedSkills: KlimandSkill[] }
  | { kind: "complete" }
  | { kind: "escalated"; reason: string };

export function nextDecision(goal: Goal, registry: KlimandSkillRegistry | null = null): DecisionPoint {
  if (goal.status === "escalated") return { kind: "escalated", reason: "goal is escalated" };
  if (goal.status === "failed") return { kind: "escalated", reason: "goal failed" };
  if (goal.status === "succeeded") return { kind: "complete" };

  if (goal.subTasks.length === 0) return { kind: "decompose" };

  const ctx: ConsultContext = { hasProject: goal.projectPath !== null };

  const running = goal.subTasks.find((st) => st.status === "running");
  if (running) return { kind: "awaiting-completion", subTask: running };

  const ready = findReadySubTask(goal);
  if (ready) {
    const skills = registry ? consult(registry, "sub-task-dispatch", { ...ctx, provider: providerFor(ready) }) : [];
    return { kind: "dispatch", subTask: ready, consultedSkills: skills };
  }

  const allDone = goal.subTasks.every((st) => st.status === "succeeded" || st.status === "skipped");
  if (allDone) {
    const skills = registry ? consult(registry, "sub-task-complete", ctx) : [];
    return { kind: "completion-check", consultedSkills: skills };
  }

  return { kind: "escalated", reason: "no ready sub-task but goal not done — dependency cycle or stuck state" };
}

function providerFor(st: SubTask): "claude" | "codex" | null {
  if (st.provider === "claude") return "claude";
  if (st.provider === "codex") return "codex";
  return null;
}

/**
 * A sub-task is "ready" when:
 *   - its status is pending
 *   - all its dependencies have status succeeded
 *
 * Returns the lowest-index ready sub-task, or null.
 */
export function findReadySubTask(goal: Goal): SubTask | null {
  const byIndex = new Map<number, SubTask>();
  for (const st of goal.subTasks) byIndex.set(st.index, st);
  const ready = goal.subTasks
    .filter((st) => st.status === "pending")
    .filter((st) => st.dependsOn.every((dep) => byIndex.get(dep)?.status === "succeeded"))
    .sort((a, b) => a.index - b.index);
  return ready[0] ?? null;
}

export interface DispatchResult {
  sessionId: string;
}

export interface EvaluationResult {
  verdict: "pass" | "partial" | "fail";
  note?: string;
}

export interface DecomposeInput {
  goal: Goal;
  consultedSkills: KlimandSkill[];
}

export interface DispatchInput {
  goal: Goal;
  subTask: SubTask;
  consultedSkills: KlimandSkill[];
}

export interface EvaluateInput {
  goal: Goal;
  subTask: SubTask;
  consultedSkills: KlimandSkill[];
  sessionOutput: string;
  exitCode: number;
}

export interface TaskAdvisor {
  decompose(input: DecomposeInput): Promise<Array<{
    description: string;
    prompt: string;
    provider: "claude" | "codex" | "claude-or-codex";
    verification: string;
    dependsOn?: number[];
  }>>;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
  evaluate(input: EvaluateInput): Promise<EvaluationResult>;
}

export interface StepOptions {
  registry?: KlimandSkillRegistry | null;
}

/**
 * Drive one decision point. Returns the new decision after the step is applied.
 * Callers loop on `runStep` until the returned decision is `complete` or `escalated`.
 */
export async function runStep(goal: Goal, advisor: TaskAdvisor, opts: StepOptions = {}): Promise<{
  goal: Goal;
  decision: DecisionPoint;
  next: DecisionPoint;
}> {
  const registry = opts.registry ?? null;
  const decision = nextDecision(goal, registry);
  let updated: Goal = goal;
  switch (decision.kind) {
    case "decompose": {
      const consulted = registry
        ? consult(registry, "goal-decomposition", { hasProject: goal.projectPath !== null })
        : [];
      const subTasks = await advisor.decompose({ goal, consultedSkills: consulted });
      const enforced = subTasks.slice(0, goal.limits.maxSubTasks);
      const u = await updateGoal(goal.id, {
        status: "running",
        subTasks: enforced.map((st, i) => ({
          id: cryptoRandomId(),
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
        decomposedBy: "goal-decomposition"
      });
      if (u) updated = u;
      break;
    }
    case "dispatch": {
      const result = await advisor.dispatch({ goal, subTask: decision.subTask, consultedSkills: decision.consultedSkills });
      const u = await updateSubTask(goal.id, decision.subTask.id, {
        status: "running",
        sessionId: result.sessionId,
        startedAt: new Date().toISOString(),
        attempts: decision.subTask.attempts + 1
      });
      if (u) updated = u;
      break;
    }
    case "awaiting-completion": {
      // Loop driver should wait on session output; here we return without
      // mutating so the outer caller can pump it. Tests can simulate this by
      // calling evaluate() directly via applyEvaluation.
      break;
    }
    case "evaluate": {
      // Never reached via nextDecision today — kept for future when evaluate is
      // its own decision point separate from dispatch completion.
      break;
    }
    case "completion-check": {
      const u = await updateGoal(goal.id, { status: "succeeded" });
      if (u) updated = u;
      break;
    }
    case "complete":
    case "escalated":
      break;
  }
  return {
    goal: updated,
    decision,
    next: nextDecision(updated, registry)
  };
}

/**
 * After a session completes externally, the caller pumps the result through here.
 * Applies the evaluation, updates the sub-task and goal status.
 */
export async function applySessionComplete(
  goal: Goal,
  subTaskId: string,
  advisor: TaskAdvisor,
  payload: { sessionOutput: string; exitCode: number },
  opts: StepOptions = {}
): Promise<Goal | null> {
  const subTask = goal.subTasks.find((st) => st.id === subTaskId);
  if (!subTask) return null;
  const registry = opts.registry ?? null;
  const consulted = registry
    ? consult(registry, "sub-task-complete", { hasProject: goal.projectPath !== null })
    : [];
  const evaluation = await advisor.evaluate({
    goal,
    subTask,
    consultedSkills: consulted,
    sessionOutput: payload.sessionOutput,
    exitCode: payload.exitCode
  });
  const updatedSubTask = await updateSubTask(goal.id, subTaskId, {
    status: evaluation.verdict === "pass" ? "succeeded" : evaluation.verdict === "partial" ? "pending" : "failed",
    completedAt: new Date().toISOString(),
    evaluation
  });
  if (!updatedSubTask) return null;

  // Goal-level rollup
  const allSucceeded = updatedSubTask.subTasks.every((st) => st.status === "succeeded" || st.status === "skipped");
  const anyFailed = updatedSubTask.subTasks.some(
    (st) => st.status === "failed" && st.attempts >= updatedSubTask.limits.maxRetriesPerSubTask + 1
  );
  if (allSucceeded) return await updateGoal(goal.id, { status: "succeeded" });
  if (anyFailed) return await updateGoal(goal.id, { status: "escalated" });
  return updatedSubTask;
}

function cryptoRandomId(): string {
  // Lazy import to keep this file pure for testing if needed
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(8).toString("hex");
}

/**
 * Render a system-prompt block describing the active goal + consulted skills.
 * Used by the chat-side bridge when goal mode is active in a thread.
 */
export function renderGoalContext(goal: Goal, trigger: KlimandSkillTrigger, consultedSkills: KlimandSkill[]): string {
  const skillsBlock = renderConsultedSkills(consultedSkills, trigger);
  const lines = [
    `## Active goal: ${goal.outcome}`,
    `Stop condition: ${goal.stopCondition}`,
    `Status: ${goal.status} · ${goal.subTasks.length} sub-tasks total`,
    `Progress: ${goal.subTasks.filter((st) => st.status === "succeeded").length}/${goal.subTasks.length} passed`
  ];
  return [lines.join("\n"), skillsBlock].filter((s) => s.length > 0).join("\n\n");
}
