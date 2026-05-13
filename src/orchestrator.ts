import { EventEmitter } from "node:events";
import path from "node:path";
import { AuditLog } from "./audit.js";
import { AgentChainConfig, AgentResult, Goal, ProviderName, Step } from "./types.js";
import { StateStore } from "./state.js";
import { ensureDir, id, nowIso, sha256, writeJson } from "./util.js";
import { runProvider } from "./providers.js";

export interface OrchestratorEvents {
  goal_created: (e: { goal: Goal }) => void;
  step_started: (e: { goalId: string; step: Step }) => void;
  step_retry: (e: { goalId: string; stepId: string; attempt: number }) => void;
  step_chunk: (e: { goalId: string; stepId: string; stream: "stdout" | "stderr"; chunk: string }) => void;
  step_finished: (e: { goalId: string; stepId: string; result: AgentResult }) => void;
  step_failed: (e: { goalId: string; stepId: string; error: string }) => void;
  goal_status: (e: { goalId: string; status: Goal["status"]; cycle: number }) => void;
}

const ROLES: Array<{ provider: ProviderName; role: string }> = [
  { provider: "claude", role: "plan" },
  { provider: "codex", role: "execute" },
  { provider: "claude", role: "review" },
  { provider: "codex", role: "repair" }
];

export class Orchestrator {
  readonly events = new EventEmitter();

  constructor(
    private readonly config: AgentChainConfig,
    private readonly store: StateStore,
    private readonly audit: AuditLog
  ) {}

  async createGoal(prompt: string, workspace: string): Promise<Goal> {
    const ts = nowIso();
    const goal: Goal = {
      id: id("goal"),
      prompt,
      workspace: path.resolve(workspace),
      status: "active",
      cycle: 0,
      createdAt: ts,
      updatedAt: ts
    };
    await ensureDir(goal.workspace);
    this.store.createGoal(goal);
    await this.audit.append({
      ts,
      goal_id: goal.id,
      action: "goal_created",
      input_sha256: sha256(prompt),
      result: "ok",
      metadata: { workspace: goal.workspace }
    });
    this.events.emit("goal_created", { goal });
    return goal;
  }

  async tick(goalId: string): Promise<AgentResult> {
    const goal = this.requireActiveGoal(goalId);
    if (goal.cycle >= this.config.maxCycles) {
      const result: AgentResult = {
        status: "blocked",
        summary: `Max cycles reached (${this.config.maxCycles}).`,
        risks: ["Goal may need human steering or a higher maxCycles setting."]
      };
      this.store.updateGoalStatus(goal.id, "blocked");
      this.events.emit("goal_status", { goalId: goal.id, status: "blocked", cycle: goal.cycle });
      return result;
    }

    const step = await this.createNextStep(goal);
    this.store.updateStep(step.id, "running");
    this.events.emit("step_started", { goalId: goal.id, step });

    const maxAttempts = Math.max(0, this.config.maxRetries) + 1;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        this.store.updateStepAttempt(step.id, attempt);
        this.events.emit("step_retry", { goalId: goal.id, stepId: step.id, attempt });
      }
      await this.audit.append({
        ts: nowIso(),
        goal_id: goal.id,
        step_id: step.id,
        provider: step.provider,
        action: attempt === 0 ? "step_started" : "step_retry",
        input_sha256: sha256(step.prompt),
        result: "ok",
        metadata: { role: step.role, attempt }
      });

      const started = Date.now();
      try {
        const run = await runProvider(this.config, step, goal.workspace, {
          onStdout: (chunk) => this.events.emit("step_chunk", { goalId: goal.id, stepId: step.id, stream: "stdout", chunk }),
          onStderr: (chunk) => this.events.emit("step_chunk", { goalId: goal.id, stepId: step.id, stream: "stderr", chunk })
        });
        this.store.saveResult(step.id, run.result);
        this.store.updateStep(step.id, resultToStepStatus(run.result), run.sessionId);
        const nextStatus = resultToGoalStatus(run.result, step.role);
        const nextCycle = goal.cycle + 1;
        this.store.updateGoalStatus(goal.id, nextStatus, nextCycle);
        await writeJson(path.join(step.artifactsDir, "result.json"), run.result);
        await this.audit.append({
          ts: nowIso(),
          goal_id: goal.id,
          step_id: step.id,
          provider: step.provider,
          action: "step_finished",
          input_sha256: sha256(step.prompt),
          output_sha256: sha256(JSON.stringify(run.result)),
          duration_ms: Date.now() - started,
          result: run.result.status === "failed" ? "error" : run.result.status === "blocked" ? "blocked" : "ok",
          metadata: { role: step.role, attempt, session_id: run.sessionId }
        });
        this.events.emit("step_finished", { goalId: goal.id, stepId: step.id, result: run.result });
        this.events.emit("goal_status", { goalId: goal.id, status: nextStatus, cycle: nextCycle });
        return run.result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await this.audit.append({
          ts: nowIso(),
          goal_id: goal.id,
          step_id: step.id,
          provider: step.provider,
          action: "step_failed",
          input_sha256: sha256(step.prompt),
          duration_ms: Date.now() - started,
          result: "error",
          error_code: "provider_error",
          metadata: { role: step.role, attempt, message: lastError }
        });
      }
    }

    this.store.updateStep(step.id, "failed");
    const failedCycle = goal.cycle + 1;
    this.store.updateGoalStatus(goal.id, "failed", failedCycle);
    this.events.emit("step_failed", { goalId: goal.id, stepId: step.id, error: lastError ?? "provider error" });
    this.events.emit("goal_status", { goalId: goal.id, status: "failed", cycle: failedCycle });
    return { status: "failed", summary: lastError ?? "provider error" };
  }

  async run(goalId: string, watch: boolean): Promise<AgentResult> {
    let last: AgentResult = { status: "continue", summary: "Starting." };
    do {
      last = await this.tick(goalId);
      if (last.status !== "continue") break;
    } while (watch);
    return last;
  }

  private async createNextStep(goal: Goal): Promise<Step> {
    const role = ROLES[goal.cycle % ROLES.length];
    const ts = nowIso();
    const prior = this.store.getLastResult(goal.id);
    const step: Step = {
      id: id("step"),
      goalId: goal.id,
      provider: role.provider,
      role: role.role,
      prompt: buildPrompt(goal, role.role, prior),
      status: "pending",
      attempt: 0,
      sessionId: null,
      artifactsDir: path.join(this.config.stateDir, "runs", goal.id, `cycle-${goal.cycle + 1}-${role.provider}-${role.role}`),
      createdAt: ts,
      updatedAt: ts
    };
    await ensureDir(step.artifactsDir);
    this.store.createStep(step);
    return step;
  }

  private requireActiveGoal(goalId: string): Goal {
    const goal = this.store.getGoal(goalId);
    if (!goal) throw new Error(`Unknown goal: ${goalId}`);
    if (goal.status !== "active") throw new Error(`Goal ${goalId} is ${goal.status}`);
    return goal;
  }
}

function buildPrompt(goal: Goal, role: string, prior: AgentResult | null): string {
  return [
    "You are a child CLI agent in a local Claude/Codex orchestration chain.",
    "Return only JSON matching this shape: {\"status\":\"done|continue|blocked|failed\",\"summary\":\"...\",\"changes\":[],\"artifacts\":[],\"verification\":[],\"risks\":[],\"next_prompt\":\"...\",\"confidence\":0.0}.",
    "Use full automation inside the workspace, but stop as blocked for missing auth, unavailable tools, destructive out-of-workspace actions, or user-only decisions.",
    "",
    `Goal: ${goal.prompt}`,
    `Workspace: ${goal.workspace}`,
    `Role for this step: ${role}`,
    prior ? `Prior result: ${JSON.stringify(prior)}` : "Prior result: none",
    "",
    role === "plan"
      ? "Decompose the goal into a concrete next implementation or verification task. Set next_prompt for Codex."
      : role === "execute"
        ? `Execute the next concrete task. Prefer the prior next_prompt when present: ${prior?.next_prompt ?? ""}`
        : role === "review"
          ? "Review the current workspace and prior result. Identify whether the goal is done or what exact repair remains."
          : `Repair or verify the remaining gap. Prefer the prior next_prompt when present: ${prior?.next_prompt ?? ""}`
  ].join("\n");
}

function resultToStepStatus(result: AgentResult): Step["status"] {
  if (result.status === "done") return "done";
  if (result.status === "blocked") return "blocked";
  if (result.status === "failed") return "failed";
  return "done";
}

function resultToGoalStatus(result: AgentResult, role: string): Goal["status"] {
  if (result.status === "blocked") return "blocked";
  if (result.status === "failed") return "failed";
  if (result.status === "done" && (role === "review" || role === "repair")) return "done";
  return "active";
}
