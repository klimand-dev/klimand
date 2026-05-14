import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import {
  applySessionComplete,
  findReadySubTask,
  nextDecision,
  runStep,
  type TaskAdvisor
} from "../../web/lib/autonomy-loop.js";
import { createGoal, getGoal, type Goal } from "../../web/lib/goals.js";
import { buildRegistryFromSkills } from "../../web/lib/klimand-skills/registry.js";

let root: string;
let prevStateDir: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "klimand-loop-"));
  prevStateDir = process.env.KLIMAND_STATE_DIR;
  process.env.KLIMAND_STATE_DIR = root;
});

afterEach(() => {
  if (prevStateDir === undefined) delete process.env.KLIMAND_STATE_DIR;
  else process.env.KLIMAND_STATE_DIR = prevStateDir;
});

function makeAdvisor(overrides: Partial<TaskAdvisor> = {}): TaskAdvisor {
  return {
    decompose: overrides.decompose ?? (async () => [
      { description: "step a", prompt: "do a", provider: "codex", verification: "ok", dependsOn: [] },
      { description: "step b", prompt: "do b", provider: "claude", verification: "ok", dependsOn: [0] }
    ]),
    dispatch: overrides.dispatch ?? (async () => ({ sessionId: "sess-test" })),
    evaluate: overrides.evaluate ?? (async () => ({ verdict: "pass" }))
  };
}

async function seedGoal(): Promise<Goal> {
  return await createGoal({
    threadId: "t",
    projectPath: null,
    outcome: "do stuff",
    stopCondition: "stuff is done",
    decomposedBy: "manual",
    subTasks: []
  });
}

describe("nextDecision", () => {
  test("empty subTasks => decompose", async () => {
    const goal = await seedGoal();
    const d = nextDecision(goal);
    expect(d.kind).toBe("decompose");
  });

  test("first eligible sub-task => dispatch", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] },
        { description: "b", prompt: "b", provider: "claude", verification: "ok", dependsOn: [0] }
      ]
    });
    const d = nextDecision(goal);
    expect(d.kind).toBe("dispatch");
    if (d.kind === "dispatch") {
      expect(d.subTask.index).toBe(0);
    }
  });

  test("running sub-task => awaiting-completion", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    goal.subTasks[0]!.status = "running";
    const d = nextDecision(goal);
    expect(d.kind).toBe("awaiting-completion");
  });

  test("all succeeded => completion-check", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    goal.subTasks[0]!.status = "succeeded";
    const d = nextDecision(goal);
    expect(d.kind).toBe("completion-check");
  });
});

describe("findReadySubTask", () => {
  test("respects dependencies", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] },
        { description: "b", prompt: "b", provider: "claude", verification: "ok", dependsOn: [0] }
      ]
    });
    // b is blocked until a succeeds
    expect(findReadySubTask(goal)?.index).toBe(0);
    goal.subTasks[0]!.status = "succeeded";
    expect(findReadySubTask(goal)?.index).toBe(1);
  });

  test("returns null when nothing is pending", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    goal.subTasks[0]!.status = "succeeded";
    expect(findReadySubTask(goal)).toBeNull();
  });
});

describe("runStep", () => {
  test("decompose populates sub-tasks and transitions to running", async () => {
    const goal = await seedGoal();
    const advisor = makeAdvisor();
    const { goal: after, decision } = await runStep(goal, advisor);
    expect(decision.kind).toBe("decompose");
    expect(after.status).toBe("running");
    expect(after.subTasks).toHaveLength(2);
    expect(after.subTasks[0]!.index).toBe(0);
    expect(after.subTasks[1]!.dependsOn).toEqual([0]);
  });

  test("dispatch starts the first sub-task", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    const advisor = makeAdvisor();
    const { goal: after } = await runStep(goal, advisor);
    expect(after.subTasks[0]!.status).toBe("running");
    expect(after.subTasks[0]!.sessionId).toBe("sess-test");
    expect(after.subTasks[0]!.attempts).toBe(1);
  });

  test("respects maxSubTasks limit during decompose", async () => {
    const goal = await seedGoal();
    const advisor = makeAdvisor({
      decompose: async () =>
        Array.from({ length: 30 }, (_, i) => ({
          description: `step ${i}`,
          prompt: "p",
          provider: "codex" as const,
          verification: "ok",
          dependsOn: [] as number[]
        }))
    });
    const { goal: after } = await runStep(goal, advisor);
    expect(after.subTasks).toHaveLength(20);
  });
});

describe("applySessionComplete", () => {
  test("pass verdict marks sub-task succeeded; goal succeeds when all done", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    const advisor = makeAdvisor();
    await runStep(goal, advisor); // dispatch
    const dispatched = await getGoal(goal.id);
    expect(dispatched!.subTasks[0]!.status).toBe("running");
    const after = await applySessionComplete(dispatched!, dispatched!.subTasks[0]!.id, advisor, {
      sessionOutput: "ok",
      exitCode: 0
    });
    expect(after!.subTasks[0]!.status).toBe("succeeded");
    expect(after!.status).toBe("succeeded");
  });

  test("fail verdict marks sub-task failed", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    const advisor = makeAdvisor({ evaluate: async () => ({ verdict: "fail", note: "broken" }) });
    await runStep(goal, advisor);
    const dispatched = await getGoal(goal.id);
    const after = await applySessionComplete(dispatched!, dispatched!.subTasks[0]!.id, advisor, {
      sessionOutput: "err",
      exitCode: 1
    });
    expect(after!.subTasks[0]!.status).toBe("failed");
    expect(after!.subTasks[0]!.evaluation?.verdict).toBe("fail");
  });
});

describe("skills consultation integration", () => {
  test("dispatch decision attaches consulted skills", async () => {
    const goal = await createGoal({
      threadId: "t",
      projectPath: "/tmp/p",
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: [
        { description: "a", prompt: "a", provider: "codex", verification: "ok", dependsOn: [] }
      ]
    });
    const registry = buildRegistryFromSkills([
      {
        name: "prompt-composer",
        description: "compose",
        triggers: ["sub-task-dispatch"],
        version: "0.1",
        body: "composer body",
        source: { kind: "bundled", path: "/fake" }
      }
    ]);
    const d = nextDecision(goal, registry);
    expect(d.kind).toBe("dispatch");
    if (d.kind === "dispatch") {
      expect(d.consultedSkills.map((s) => s.name)).toEqual(["prompt-composer"]);
    }
  });
});
