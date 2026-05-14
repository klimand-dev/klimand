import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { AgentResult, Goal, GoalStatus, Step, StepStatus } from "./types.js";
import { ensureDir, nowIso } from "./util.js";

export class StateStore {
  readonly dbPath: string;
  private db: DatabaseSync | null = null;

  constructor(readonly stateDir: string) {
    this.dbPath = path.join(stateDir, "klimand.sqlite");
  }

  async open(): Promise<void> {
    await ensureDir(this.stateDir);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        workspace TEXT NOT NULL,
        status TEXT NOT NULL,
        cycle INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        role TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        session_id TEXT,
        artifacts_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        step_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  createGoal(goal: Goal): void {
    this.database
      .prepare(
        "INSERT INTO goals (id, prompt, workspace, status, cycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(goal.id, goal.prompt, goal.workspace, goal.status, goal.cycle, goal.createdAt, goal.updatedAt);
  }

  getGoal(id: string): Goal | null {
    const row = this.database.prepare("SELECT * FROM goals WHERE id = ?").get(id) as Row | undefined;
    return row ? mapGoal(row) : null;
  }

  listGoals(): Goal[] {
    const rows = this.database.prepare("SELECT * FROM goals ORDER BY created_at DESC").all() as Row[];
    return rows.map(mapGoal);
  }

  updateGoalStatus(id: string, status: GoalStatus, cycle?: number): void {
    const ts = nowIso();
    if (cycle === undefined) {
      this.database.prepare("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?").run(status, ts, id);
    } else {
      this.database.prepare("UPDATE goals SET status = ?, cycle = ?, updated_at = ? WHERE id = ?").run(status, cycle, ts, id);
    }
  }

  createStep(step: Step): void {
    this.database
      .prepare(
        "INSERT INTO steps (id, goal_id, provider, role, prompt, status, attempt, session_id, artifacts_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        step.id,
        step.goalId,
        step.provider,
        step.role,
        step.prompt,
        step.status,
        step.attempt,
        step.sessionId,
        step.artifactsDir,
        step.createdAt,
        step.updatedAt
      );
  }

  updateStep(id: string, status: StepStatus, sessionId?: string | null): void {
    const ts = nowIso();
    this.database.prepare("UPDATE steps SET status = ?, session_id = COALESCE(?, session_id), updated_at = ? WHERE id = ?").run(status, sessionId ?? null, ts, id);
  }

  updateStepAttempt(id: string, attempt: number): void {
    const ts = nowIso();
    this.database.prepare("UPDATE steps SET attempt = ?, updated_at = ? WHERE id = ?").run(attempt, ts, id);
  }

  getSteps(goalId: string): Step[] {
    const rows = this.database.prepare("SELECT * FROM steps WHERE goal_id = ? ORDER BY created_at ASC").all(goalId) as Row[];
    return rows.map(mapStep);
  }

  saveResult(stepId: string, result: AgentResult): void {
    this.database
      .prepare("INSERT OR REPLACE INTO results VALUES (?, ?, ?)")
      .run(stepId, JSON.stringify(result), nowIso());
  }

  getLastResult(goalId: string): AgentResult | null {
    const row = this.database
      .prepare(
        `SELECT r.result_json
         FROM results r JOIN steps s ON s.id = r.step_id
         WHERE s.goal_id = ?
         ORDER BY s.created_at DESC
         LIMIT 1`
      )
      .get(goalId) as { result_json: string } | undefined;
    return row ? (JSON.parse(row.result_json) as AgentResult) : null;
  }

  private get database(): DatabaseSync {
    if (!this.db) throw new Error("StateStore is not open");
    return this.db;
  }
}

type Row = Record<string, string | number | null>;

function mapGoal(row: Row): Goal {
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    workspace: String(row.workspace),
    status: row.status as GoalStatus,
    cycle: Number(row.cycle),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapStep(row: Row): Step {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    provider: row.provider as Step["provider"],
    role: String(row.role),
    prompt: String(row.prompt),
    status: row.status as StepStatus,
    attempt: Number(row.attempt),
    sessionId: row.session_id ? String(row.session_id) : null,
    artifactsDir: String(row.artifacts_dir),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
