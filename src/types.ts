export type ProviderName = "claude" | "codex";

export type GoalStatus = "active" | "done" | "blocked" | "failed" | "stopped";
export type StepStatus = "pending" | "running" | "done" | "blocked" | "failed";
export type AgentResultStatus = "done" | "continue" | "blocked" | "failed";

export interface ProviderConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentChainConfig {
  stateDir: string;
  maxCycles: number;
  stepTimeoutMs: number;
  maxRetries: number;
  providers: Record<ProviderName, ProviderConfig>;
}

export interface Goal {
  id: string;
  prompt: string;
  workspace: string;
  status: GoalStatus;
  cycle: number;
  createdAt: string;
  updatedAt: string;
}

export interface Step {
  id: string;
  goalId: string;
  provider: ProviderName;
  role: string;
  prompt: string;
  status: StepStatus;
  attempt: number;
  sessionId: string | null;
  artifactsDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentResult {
  status: AgentResultStatus;
  summary: string;
  changes?: string[];
  artifacts?: string[];
  verification?: string[];
  risks?: string[];
  next_prompt?: string;
  confidence?: number;
}

export interface AuditEvent {
  ts: string;
  goal_id: string;
  step_id?: string;
  provider?: ProviderName;
  action: string;
  input_sha256?: string;
  output_sha256?: string;
  duration_ms?: number;
  result: "ok" | "error" | "blocked";
  error_code?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRun {
  result: AgentResult;
  sessionId: string | null;
  rawOutput: string;
}
