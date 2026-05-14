import { describe, expect, test } from "vitest";
import { detectGoalShape } from "../../web/lib/goal-shape-detector.js";

describe("detectGoalShape", () => {
  test("short messages are not goal-shaped", () => {
    expect(detectGoalShape("hi").isGoalShaped).toBe(false);
    expect(detectGoalShape("what's up").isGoalShaped).toBe(false);
  });

  test("clear multi-step build request is high-confidence goal", () => {
    const r = detectGoalShape("Build a CRUD API for users with tests and migrations");
    expect(r.isGoalShaped).toBe(true);
    expect(r.confidence).toBe("high");
  });

  test("ship feature with implied steps", () => {
    const r = detectGoalShape("Ship the search feature, then add tests and update the docs");
    expect(r.isGoalShaped).toBe(true);
    expect(["medium", "high"]).toContain(r.confidence);
  });

  test("simple chat question stays a chat", () => {
    expect(detectGoalShape("how does this hook work?").isGoalShaped).toBe(false);
  });

  test("refactor request without strong signals can still register", () => {
    const r = detectGoalShape("Refactor the auth middleware to use the new session API");
    expect(r.isGoalShaped).toBe(true);
  });
});
