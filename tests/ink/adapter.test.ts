import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { AuditLog } from "../../src/audit.js";
import { Orchestrator } from "../../src/orchestrator.js";
import { StateStore } from "../../src/state.js";
import { createDashboardAdapter, getGoalThread, listGoalThreads } from "../../src/ink/adapter.js";

let stateDir: string;
let workspace: string;

beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "klimand-ink-"));
  stateDir = path.join(root, ".klimand");
  workspace = path.join(root, "workspace");
});

describe("dashboard adapter", () => {
  test("returns an empty goal list for a fresh store", async () => {
    const store = new StateStore(stateDir);
    await store.open();
    expect(listGoalThreads(store)).toEqual([]);
    store.close();
  });

  test("creating a goal yields a thread with a single user message", async () => {
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(
      { stateDir, maxCycles: 1, stepTimeoutMs: 1000, maxRetries: 0, providers: { codex: { command: "x", args: [] }, claude: { command: "x", args: [] } } },
      store,
      new AuditLog(stateDir)
    );
    const goal = await orchestrator.createGoal("Ship a tiny feature", workspace);
    const threads = listGoalThreads(store);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.goalId).toBe(goal.id);
    expect(threads[0]?.messages).toHaveLength(1);
    expect(threads[0]?.messages[0]?.role).toBe("user");
    expect(threads[0]?.messages[0]?.text).toBe("Ship a tiny feature");
    expect(threads[0]?.status).toBe("active");
    store.close();
  });

  test("subscribe fires on orchestrator events", async () => {
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(
      { stateDir, maxCycles: 1, stepTimeoutMs: 1000, maxRetries: 0, providers: { codex: { command: "x", args: [] }, claude: { command: "x", args: [] } } },
      store,
      new AuditLog(stateDir)
    );
    const adapter = createDashboardAdapter({ store, orchestrator });
    let calls = 0;
    const unsub = adapter.subscribe(() => {
      calls += 1;
    });
    await orchestrator.createGoal("Goal A", workspace);
    expect(calls).toBe(1);
    orchestrator.events.emit("goal_status", { goalId: "x", status: "done", cycle: 1 });
    expect(calls).toBe(2);
    unsub();
    orchestrator.events.emit("goal_status", { goalId: "y", status: "done", cycle: 1 });
    expect(calls).toBe(2);
    store.close();
  });

  test("subscribeChunks forwards step_chunk events", async () => {
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(
      { stateDir, maxCycles: 1, stepTimeoutMs: 1000, maxRetries: 0, providers: { codex: { command: "x", args: [] }, claude: { command: "x", args: [] } } },
      store,
      new AuditLog(stateDir)
    );
    const adapter = createDashboardAdapter({ store, orchestrator });
    const received: string[] = [];
    const unsub = adapter.subscribeChunks((e) => received.push(`${e.stream}:${e.chunk}`));
    orchestrator.events.emit("step_chunk", { goalId: "g", stepId: "s", stream: "stdout", chunk: "hello" });
    orchestrator.events.emit("step_chunk", { goalId: "g", stepId: "s", stream: "stderr", chunk: "err" });
    expect(received).toEqual(["stdout:hello", "stderr:err"]);
    unsub();
    store.close();
  });

  test("getGoalThread returns null for unknown goals", async () => {
    const store = new StateStore(stateDir);
    await store.open();
    expect(getGoalThread(store, "nope")).toBeNull();
    store.close();
  });
});
