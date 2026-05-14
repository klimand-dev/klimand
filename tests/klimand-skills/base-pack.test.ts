import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadKlimandSkills } from "../../web/lib/klimand-skills/loader.js";

// vitest runs from the repo root (working dir); the bundled pack sits at <repo>/klimand/skills/base.
const REPO_ROOT = process.cwd();
const BUNDLED = path.join(REPO_ROOT, "klimand", "skills", "base");

const EXPECTED = [
  "completion-detection",
  "conflict-resolution",
  "dependency-management",
  "escalation-judgement",
  "failure-diagnosis",
  "git-hygiene",
  "goal-decomposition",
  "output-evaluation",
  "prompt-composer",
  "routing-decision",
  "session-monitoring",
  "test-orchestration"
];

describe("bundled base skill pack", () => {
  test("all expected skills load without errors", async () => {
    const result = await loadKlimandSkills({ bundledDir: BUNDLED, userDir: path.join(REPO_ROOT, ".__nonexistent_user__") });
    expect(result.errors).toEqual([]);
    const names = result.skills.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(EXPECTED);
  });

  test("every skill has at least one trigger and a non-empty body", async () => {
    const result = await loadKlimandSkills({ bundledDir: BUNDLED, userDir: path.join(REPO_ROOT, ".__nonexistent_user__") });
    for (const s of result.skills) {
      expect(s.triggers.length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(0);
    }
  });
});
