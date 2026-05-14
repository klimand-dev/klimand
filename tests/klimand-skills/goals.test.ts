import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import {
  createGoal,
  deleteGoal,
  getGoal,
  listGoals,
  updateGoal,
  updateSubTask
} from "../../web/lib/goals.js";

let root: string;
let prevStateDir: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "klimand-goals-"));
  prevStateDir = process.env.KLIMAND_STATE_DIR;
  process.env.KLIMAND_STATE_DIR = root;
});

afterEach(() => {
  if (prevStateDir === undefined) delete process.env.KLIMAND_STATE_DIR;
  else process.env.KLIMAND_STATE_DIR = prevStateDir;
});

function seedSubTasks() {
  return [
    {
      description: "first sub-task",
      prompt: "do first thing",
      provider: "codex" as const,
      verification: "file exists",
      dependsOn: [] as number[]
    },
    {
      description: "second sub-task",
      prompt: "do second thing",
      provider: "claude" as const,
      verification: "tests pass",
      dependsOn: [0]
    }
  ];
}

describe("goals persistence", () => {
  test("create then get round-trips the full goal", async () => {
    const created = await createGoal({
      threadId: "thread-1",
      projectPath: "/tmp/proj",
      outcome: "ship feature X",
      stopCondition: "tests pass on main",
      decomposedBy: "goal-decomposition",
      subTasks: seedSubTasks()
    });
    const fetched = await getGoal(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.outcome).toBe("ship feature X");
    expect(fetched!.subTasks).toHaveLength(2);
    expect(fetched!.subTasks[0]!.index).toBe(0);
    expect(fetched!.subTasks[1]!.dependsOn).toEqual([0]);
    expect(fetched!.status).toBe("planning");
  });

  test("listGoals filters by threadId", async () => {
    const a = await createGoal({
      threadId: "thread-1",
      projectPath: null,
      outcome: "a",
      stopCondition: "a",
      decomposedBy: "manual",
      subTasks: []
    });
    const b = await createGoal({
      threadId: "thread-2",
      projectPath: null,
      outcome: "b",
      stopCondition: "b",
      decomposedBy: "manual",
      subTasks: []
    });
    const list = await listGoals({ threadId: "thread-1" });
    expect(list.map((g) => g.id)).toEqual([a.id]);
    expect(list.find((g) => g.id === b.id)).toBeUndefined();
  });

  test("updateGoal patches status and updates updatedAt", async () => {
    const created = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: []
    });
    // Wait at least a millisecond so updatedAt differs.
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updateGoal(created.id, { status: "running" });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("running");
    expect(updated!.updatedAt > created.updatedAt).toBe(true);
  });

  test("updateSubTask mutates a single sub-task without touching others", async () => {
    const created = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: seedSubTasks()
    });
    const target = created.subTasks[0]!;
    const updated = await updateSubTask(created.id, target.id, {
      status: "running",
      sessionId: "sess-xyz",
      startedAt: new Date().toISOString(),
      attempts: 1
    });
    expect(updated).not.toBeNull();
    expect(updated!.subTasks[0]!.status).toBe("running");
    expect(updated!.subTasks[0]!.sessionId).toBe("sess-xyz");
    expect(updated!.subTasks[1]!.status).toBe("pending");
  });

  test("deleteGoal removes the file", async () => {
    const created = await createGoal({
      threadId: "t",
      projectPath: null,
      outcome: "x",
      stopCondition: "x",
      decomposedBy: "manual",
      subTasks: []
    });
    expect(await deleteGoal(created.id)).toBe(true);
    expect(await getGoal(created.id)).toBeNull();
  });

  test("getGoal returns null for unknown id", async () => {
    expect(await getGoal("does-not-exist")).toBeNull();
  });
});
