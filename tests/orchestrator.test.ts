import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import { AuditLog } from "../src/audit.js";
import { Orchestrator } from "../src/orchestrator.js";
import { StateStore } from "../src/state.js";
import { KlimandConfig } from "../src/types.js";

const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cli.cjs");

let root: string;
let workspace: string;
let stateDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "klimand-"));
  workspace = path.join(root, "workspace");
  stateDir = path.join(root, ".klimand");
});

function makeConfig(overrides: {
  maxCycles?: number;
  maxRetries?: number;
  claudeResults: unknown[];
  codexResults: unknown[];
  claudeCounter?: string;
  codexCounter?: string;
}): KlimandConfig {
  return {
    stateDir,
    maxCycles: overrides.maxCycles ?? 4,
    stepTimeoutMs: 10000,
    maxRetries: overrides.maxRetries ?? 0,
    providers: {
      claude: {
        command: "node",
        args: [FAKE_CLI],
        env: {
          FAKE_NAME: "claude",
          FAKE_RESULTS_JSON: JSON.stringify(overrides.claudeResults),
          ...(overrides.claudeCounter ? { FAKE_COUNTER_FILE: overrides.claudeCounter } : {})
        }
      },
      codex: {
        command: "node",
        args: [FAKE_CLI],
        env: {
          FAKE_NAME: "codex",
          FAKE_RESULTS_JSON: JSON.stringify(overrides.codexResults),
          ...(overrides.codexCounter ? { FAKE_COUNTER_FILE: overrides.codexCounter } : {})
        }
      }
    }
  };
}

describe("Orchestrator", () => {
  test("creates a goal, runs chained providers, and persists audit/results", async () => {
    const config = makeConfig({
      claudeResults: [
        { status: "continue", summary: "Plan ready.", next_prompt: "Create the requested file.", confidence: 0.8 }
      ],
      codexResults: [
        {
          status: "continue",
          summary: "Implemented.",
          changes: ["Created file"],
          verification: ["fake test passed"],
          confidence: 0.9
        }
      ]
    });
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(config, store, new AuditLog(stateDir));
    const goal = await orchestrator.createGoal("Ship a tiny feature", workspace);

    const first = await orchestrator.tick(goal.id);
    expect(first.status).toBe("continue");
    expect(store.getGoal(goal.id)?.status).toBe("active");

    const second = await orchestrator.tick(goal.id);
    expect(second.status).toBe("continue");
    expect(store.getGoal(goal.id)?.status).toBe("active");
    expect(store.getSteps(goal.id)).toHaveLength(2);

    const audit = await readFile(path.join(stateDir, "audit.jsonl"), "utf8");
    expect(audit).toContain("goal_created");
    expect(audit).toContain("step_finished");
    store.close();
  });

  test("done from review finalizes the goal", async () => {
    const config = makeConfig({
      claudeResults: [
        { status: "continue", summary: "Plan ready." },
        { status: "done", summary: "Verified." }
      ],
      claudeCounter: path.join(root, "claude.counter"),
      codexResults: [
        { status: "continue", summary: "Executed." }
      ]
    });
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(config, store, new AuditLog(stateDir));
    const goal = await orchestrator.createGoal("Ship and verify", workspace);

    await orchestrator.tick(goal.id); // plan (claude) -> continue
    await orchestrator.tick(goal.id); // execute (codex) -> continue
    const review = await orchestrator.tick(goal.id); // review (claude) -> done
    expect(review.status).toBe("done");
    expect(store.getGoal(goal.id)?.status).toBe("done");
    store.close();
  });

  test("plan returning done does not finalize the goal", async () => {
    const config = makeConfig({
      claudeResults: [{ status: "done", summary: "Already satisfied." }],
      codexResults: [{ status: "continue", summary: "noop" }]
    });
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(config, store, new AuditLog(stateDir));
    const goal = await orchestrator.createGoal("Goal", workspace);

    const result = await orchestrator.tick(goal.id);
    expect(result.status).toBe("done");
    const stored = store.getGoal(goal.id);
    expect(stored?.status).toBe("active");
    expect(stored?.cycle).toBe(1);
    store.close();
  });

  test("step failure retries up to maxRetries then succeeds", async () => {
    const config = makeConfig({
      maxRetries: 2,
      claudeResults: [{ status: "continue", summary: "Plan ready." }],
      codexResults: [
        { __fail__: "first failure" },
        { __fail__: "second failure" },
        { status: "continue", summary: "Implemented on retry." }
      ],
      codexCounter: path.join(root, "codex.counter")
    });
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(config, store, new AuditLog(stateDir));
    const goal = await orchestrator.createGoal("Retry me", workspace);

    await orchestrator.tick(goal.id); // plan -> continue
    const second = await orchestrator.tick(goal.id); // execute -> fail, fail, then continue
    expect(second.status).toBe("continue");
    expect(store.getGoal(goal.id)?.status).toBe("active");

    const audit = await readFile(path.join(stateDir, "audit.jsonl"), "utf8");
    const retryLines = audit.split("\n").filter((line) => line.includes("\"step_retry\""));
    expect(retryLines.length).toBe(2);
    store.close();
  });

  test("marks provider failures as failed after exhausting retries", async () => {
    const config = makeConfig({
      claudeResults: [{ status: "continue", summary: "Plan ready." }],
      codexResults: [{ __fail__: "forced failure" }]
    });
    const store = new StateStore(stateDir);
    await store.open();
    const orchestrator = new Orchestrator(config, store, new AuditLog(stateDir));
    const goal = await orchestrator.createGoal("Fail after planning", workspace);

    await orchestrator.tick(goal.id);
    const failed = await orchestrator.tick(goal.id);
    expect(failed.status).toBe("failed");
    expect(store.getGoal(goal.id)?.status).toBe("failed");
    store.close();
  });
});
