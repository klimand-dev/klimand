import { getGoal, updateGoal, updateSubTask, type Goal } from "./goals";
import { nextDecision, runStep, applySessionComplete, type TaskAdvisor } from "./autonomy-loop";
import { getRegistry } from "./klimand-skills";
import { createAgentAdvisor } from "./agent-advisor";
import { publish } from "./event-channel";
import { runProvider } from "./cli-tools";
import { abort as abortBroker } from "./tool-output-broker";
import { getPrefs } from "./prefs";

interface ActiveRun {
  goalId: string;
  startedAt: number;
  currentCallId: string | null;
  cancelled: boolean;
  cancel: () => void;
  promise: Promise<void>;
}

const G = globalThis as unknown as { __klimandGoalRunners?: Map<string, ActiveRun> };
function runners(): Map<string, ActiveRun> {
  if (!G.__klimandGoalRunners) G.__klimandGoalRunners = new Map();
  return G.__klimandGoalRunners;
}

export interface StartGoalResult {
  started: boolean;
  alreadyRunning: boolean;
}

export function startGoal(goalId: string, advisor?: TaskAdvisor): StartGoalResult {
  if (runners().has(goalId)) return { started: false, alreadyRunning: true };
  const run: ActiveRun = {
    goalId,
    startedAt: Date.now(),
    currentCallId: null,
    cancelled: false,
    cancel: () => {
      run.cancelled = true;
      if (run.currentCallId) abortBroker(run.currentCallId);
    },
    promise: Promise.resolve()
  };
  const effectiveAdvisor = advisor ?? createAgentAdvisor();
  runners().set(goalId, run);
  run.promise = runGoalLoop(goalId, run, effectiveAdvisor).finally(() => {
    runners().delete(goalId);
  });
  return { started: true, alreadyRunning: false };
}

export function isRunning(goalId: string): boolean {
  return runners().has(goalId);
}

export function cancelGoal(goalId: string): boolean {
  const r = runners().get(goalId);
  if (!r) return false;
  r.cancel();
  return true;
}

export async function awaitGoal(goalId: string): Promise<void> {
  const r = runners().get(goalId);
  if (!r) return;
  await r.promise.catch(() => {});
}

function isTerminal(g: Goal): boolean {
  return g.status === "succeeded" || g.status === "failed" || g.status === "escalated";
}

async function publishSafe(goalId: string, kind: "session.started" | "session.exit" | "session.cancelled" | "session.error" | "goal.subtask.dispatched" | "goal.subtask.completed" | "goal.completed" | "goal.escalated", data?: Record<string, unknown>): Promise<void> {
  try {
    await publish(`goal:${goalId}`, data === undefined ? { kind } : { kind, data });
  } catch {
    /* event bus errors should not abort the goal */
  }
}

async function runGoalLoop(
  goalId: string,
  run: ActiveRun,
  advisor: TaskAdvisor
): Promise<void> {
  await publishSafe(goalId, "session.started", { phase: "goal" });

  // Safety bound: prevent runaway loops on a misbehaving advisor.
  const MAX_ITERATIONS = 200;
  let iters = 0;

  try {
    while (iters++ < MAX_ITERATIONS) {
      if (run.cancelled) {
        await updateGoal(goalId, { status: "failed" });
        await publishSafe(goalId, "session.cancelled");
        return;
      }

      const goal = await getGoal(goalId);
      if (!goal) return;
      if (isTerminal(goal)) return;
      if (goal.status === "paused") {
        await publishSafe(goalId, "session.exit", { reason: "paused" });
        return;
      }

      // Wall-clock guard.
      if (Date.now() - new Date(goal.createdAt).getTime() > goal.limits.maxWallClockMs) {
        await updateGoal(goalId, { status: "escalated" });
        await publishSafe(goalId, "goal.escalated", { reason: "wall-clock budget exceeded" });
        return;
      }

      const registry = await getRegistry({ projectPath: goal.projectPath ?? null }).catch(() => null);
      const decision = nextDecision(goal, registry);

      if (decision.kind === "complete") {
        await publishSafe(goalId, "goal.completed");
        return;
      }
      if (decision.kind === "escalated") {
        await updateGoal(goalId, { status: "escalated" });
        await publishSafe(goalId, "goal.escalated", { reason: decision.reason });
        return;
      }
      if (decision.kind === "awaiting-completion") {
        // v1 model is fully synchronous: a dispatched sub-task always completes
        // inside the same loop iteration before this state is observed.
        // Reaching here means something else (e.g. a manual PATCH) flipped a
        // sub-task to "running". Treat it as stuck and escalate so the user
        // can see what happened.
        await updateGoal(goalId, { status: "escalated" });
        await publishSafe(goalId, "goal.escalated", { reason: "unexpected awaiting-completion state" });
        return;
      }
      if (decision.kind === "decompose") {
        try {
          const stepResult = await runStep(goal, advisor, { registry });
          await publishSafe(goalId, "goal.subtask.dispatched", {
            phase: "decomposed",
            count: stepResult.goal.subTasks.length
          });
        } catch (e) {
          await publishSafe(goalId, "session.error", {
            phase: "decompose",
            message: e instanceof Error ? e.message : String(e)
          });
          await updateGoal(goalId, { status: "escalated" });
          return;
        }
        continue;
      }
      if (decision.kind === "completion-check") {
        await runStep(goal, advisor, { registry });
        continue;
      }
      if (decision.kind === "dispatch") {
        const subTask = decision.subTask;
        const provider: "claude" | "codex" =
          subTask.provider === "claude"
            ? "claude"
            : subTask.provider === "codex"
              ? "codex"
              : "codex"; // claude-or-codex → default to codex for execution work
        const callId = `goal-${goalId}-st-${subTask.id}-a${subTask.attempts + 1}`;
        run.currentCallId = callId;

        await updateSubTask(goalId, subTask.id, {
          status: "running",
          sessionId: callId,
          startedAt: new Date().toISOString(),
          attempts: subTask.attempts + 1
        });
        await publishSafe(goalId, "goal.subtask.dispatched", {
          subTaskId: subTask.id,
          index: subTask.index,
          provider,
          attempt: subTask.attempts + 1
        });

        const prefs = await getPrefs().catch(() => undefined);
        let summary;
        try {
          summary = await runProvider({
            callId,
            provider,
            prompt: subTask.prompt,
            threadId: goal.threadId,
            projectPath: goal.projectPath ?? undefined,
            approval: "auto",
            prefs
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          summary = {
            provider,
            exit_code: 1,
            duration_ms: 0,
            final_text: `Failed to launch ${provider}: ${message}`,
            final_text_parsed: false,
            notes: ["spawn or runtime error"]
          };
        }
        run.currentCallId = null;

        const latest = await getGoal(goalId);
        if (!latest) return;
        const after = await applySessionComplete(
          latest,
          subTask.id,
          advisor,
          { sessionOutput: summary.final_text, exitCode: summary.exit_code },
          { registry }
        );
        const verdict = after?.subTasks.find((st) => st.id === subTask.id)?.evaluation?.verdict ?? null;
        await publishSafe(goalId, "goal.subtask.completed", {
          subTaskId: subTask.id,
          index: subTask.index,
          provider,
          exitCode: summary.exit_code,
          verdict
        });

        if (after?.status === "succeeded") {
          await publishSafe(goalId, "goal.completed");
          return;
        }
        if (after?.status === "escalated") {
          await publishSafe(goalId, "goal.escalated", { reason: "sub-task exceeded retry budget" });
          return;
        }
        continue;
      }
    }
    // Iteration bound exceeded.
    await updateGoal(goalId, { status: "escalated" });
    await publishSafe(goalId, "goal.escalated", { reason: "iteration cap exceeded" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await publishSafe(goalId, "session.error", { message });
    await updateGoal(goalId, { status: "escalated" }).catch(() => {});
  }
}
