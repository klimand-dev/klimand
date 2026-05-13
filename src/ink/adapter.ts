import type { ChatModelAdapter } from "@assistant-ui/react-ink";
import type { AgentResult, Goal, Step } from "../types.js";
import { StateStore } from "../state.js";
import { Orchestrator } from "../orchestrator.js";

export interface ThreadMessageView {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  metadata?: {
    provider?: string;
    stepRole?: string;
    cycle?: number;
    attempt?: number;
    status?: string;
    durationMs?: number;
  };
}

export interface GoalThreadView {
  goalId: string;
  title: string;
  status: Goal["status"];
  cycle: number;
  messages: ThreadMessageView[];
  runningStepId: string | null;
  runningStepArtifactsDir: string | null;
}

export function listGoalThreads(store: StateStore): GoalThreadView[] {
  return store.listGoals().map((goal) => buildThread(store, goal));
}

export function getGoalThread(store: StateStore, goalId: string): GoalThreadView | null {
  const goal = store.getGoal(goalId);
  if (!goal) return null;
  return buildThread(store, goal);
}

function buildThread(store: StateStore, goal: Goal): GoalThreadView {
  const steps = store.getSteps(goal.id);
  const messages: ThreadMessageView[] = [
    {
      id: `${goal.id}:prompt`,
      role: "user",
      text: goal.prompt
    }
  ];
  for (const step of steps) {
    const result = readResult(store, step);
    messages.push(stepToMessage(step, result));
  }
  const running = steps.find((s) => s.status === "running") ?? null;
  return {
    goalId: goal.id,
    title: truncate(goal.prompt, 60),
    status: goal.status,
    cycle: goal.cycle,
    messages,
    runningStepId: running?.id ?? null,
    runningStepArtifactsDir: running?.artifactsDir ?? null
  };
}

function readResult(store: StateStore, step: Step): AgentResult | null {
  if (step.status !== "done" && step.status !== "blocked" && step.status !== "failed") return null;
  const last = store.getLastResult(step.goalId);
  return last;
}

function stepToMessage(step: Step, result: AgentResult | null): ThreadMessageView {
  const body = result ? formatResult(result) : `(${step.status})`;
  return {
    id: step.id,
    role: "assistant",
    text: body,
    metadata: {
      provider: step.provider,
      stepRole: step.role,
      attempt: step.attempt,
      status: step.status
    }
  };
}

function formatResult(result: AgentResult): string {
  const lines = [result.summary];
  if (result.changes?.length) lines.push("", "Changes:", ...result.changes.map((c) => `  - ${c}`));
  if (result.verification?.length) lines.push("", "Verification:", ...result.verification.map((v) => `  - ${v}`));
  if (result.risks?.length) lines.push("", "Risks:", ...result.risks.map((r) => `  - ${r}`));
  if (result.next_prompt) lines.push("", `Next: ${result.next_prompt}`);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// Read-only ChatModelAdapter for assistant-ui's useLocalRuntime.
// The TUI is an observer of the orchestrator-driven run loop, so run() is never
// invoked in the dashboard flow today; we return an empty result if it ever is.
// Phase 2 (steering messages) is where this becomes interactive.
export function createReadOnlyChatModel(): ChatModelAdapter {
  return {
    async run() {
      return { content: [] };
    }
  };
}

// Convert a GoalThreadView into the ThreadMessageLike shape that useLocalRuntime
// accepts as initialMessages.
export function toInitialMessages(view: GoalThreadView): Array<{
  role: "user" | "assistant" | "system";
  content: Array<{ type: "text"; text: string }>;
}> {
  return view.messages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: messageRender(m) }]
  }));
}

function messageRender(m: ThreadMessageView): string {
  if (m.role === "user") return m.text;
  const meta = m.metadata;
  const header = meta
    ? `[${meta.provider}/${meta.stepRole}${meta.attempt ? ` retry=${meta.attempt}` : ""} · ${meta.status}]`
    : "";
  return header ? `${header}\n${m.text}` : m.text;
}

// Adapter facade with the small surface the dashboard actually uses.
export interface DashboardAdapter {
  listGoals(): GoalThreadView[];
  getGoal(goalId: string): GoalThreadView | null;
  subscribe(cb: () => void): () => void;
  subscribeChunks(cb: (e: { goalId: string; stepId: string; stream: "stdout" | "stderr"; chunk: string }) => void): () => void;
}

export function createDashboardAdapter(deps: { store: StateStore; orchestrator?: Orchestrator }): DashboardAdapter {
  const { store, orchestrator } = deps;
  return {
    listGoals: () => listGoalThreads(store),
    getGoal: (id) => getGoalThread(store, id),
    subscribe(cb) {
      if (!orchestrator) return () => {};
      const events = ["goal_created", "goal_status", "step_started", "step_finished", "step_failed"] as const;
      events.forEach((e) => orchestrator.events.on(e, cb));
      return () => events.forEach((e) => orchestrator.events.off(e, cb));
    },
    subscribeChunks(cb) {
      if (!orchestrator) return () => {};
      orchestrator.events.on("step_chunk", cb);
      return () => orchestrator.events.off("step_chunk", cb);
    }
  };
}
