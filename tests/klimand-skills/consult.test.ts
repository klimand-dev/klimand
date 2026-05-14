import { describe, expect, test } from "vitest";
import { appliesWhen, consult, renderConsultedSkills } from "../../web/lib/klimand-skills/consult.js";
import { buildRegistryFromSkills } from "../../web/lib/klimand-skills/registry.js";
import type { KlimandSkill } from "../../web/lib/klimand-skills/types.js";

function skill(opts: {
  name: string;
  triggers?: KlimandSkill["triggers"];
  appliesWhen?: string;
  body?: string;
}): KlimandSkill {
  const result: KlimandSkill = {
    name: opts.name,
    description: `${opts.name} desc`,
    triggers: opts.triggers ?? ["sub-task-dispatch"],
    version: "0.1",
    body: opts.body ?? `body of ${opts.name}`,
    source: { kind: "bundled", path: `/tmp/${opts.name}.md` }
  };
  if (opts.appliesWhen !== undefined) {
    result.appliesWhen = opts.appliesWhen;
  }
  return result;
}

describe("appliesWhen", () => {
  test("undefined or empty guard always passes", () => {
    expect(appliesWhen(undefined, {})).toBe(true);
    expect(appliesWhen("", {})).toBe(true);
    expect(appliesWhen("   ", {})).toBe(true);
  });

  test("has_project flag", () => {
    expect(appliesWhen("has_project", { hasProject: true })).toBe(true);
    expect(appliesWhen("has_project", { hasProject: false })).toBe(false);
    expect(appliesWhen("has_project", {})).toBe(false);
  });

  test("provider equality and inequality", () => {
    expect(appliesWhen("provider == 'claude'", { provider: "claude" })).toBe(true);
    expect(appliesWhen("provider == 'claude'", { provider: "codex" })).toBe(false);
    expect(appliesWhen("provider != 'codex'", { provider: "claude" })).toBe(true);
    expect(appliesWhen("provider != 'codex'", { provider: "codex" })).toBe(false);
  });

  test("tools.has()", () => {
    expect(appliesWhen("tools.has('grep')", { toolNames: ["grep", "ls"] })).toBe(true);
    expect(appliesWhen("tools.has('grep')", { toolNames: ["ls"] })).toBe(false);
    expect(appliesWhen("tools.has('grep')", {})).toBe(false);
  });

  test("compound expressions: && and ||", () => {
    const ctx = { hasProject: true, provider: "claude" as const };
    expect(appliesWhen("has_project && provider == 'claude'", ctx)).toBe(true);
    expect(appliesWhen("has_project && provider == 'codex'", ctx)).toBe(false);
    expect(appliesWhen("provider == 'codex' || has_project", ctx)).toBe(true);
  });

  test("negation with !", () => {
    expect(appliesWhen("!has_project", { hasProject: false })).toBe(true);
    expect(appliesWhen("!has_project", { hasProject: true })).toBe(false);
    expect(appliesWhen("!(provider == 'codex')", { provider: "claude" })).toBe(true);
  });

  test("unparseable expression defaults to true (fail-open)", () => {
    expect(appliesWhen("totally not real syntax %^&", {})).toBe(true);
  });
});

describe("consult", () => {
  test("returns only skills matching the trigger", () => {
    const a = skill({ name: "a", triggers: ["sub-task-dispatch"] });
    const b = skill({ name: "b", triggers: ["sub-task-complete"] });
    const registry = buildRegistryFromSkills([a, b]);
    const out = consult(registry, "sub-task-dispatch");
    expect(out.map((s: KlimandSkill) => s.name)).toEqual(["a"]);
  });

  test("filters by applies_when guard", () => {
    const guarded = skill({ name: "guarded", appliesWhen: "has_project" });
    const open = skill({ name: "open" });
    const registry = buildRegistryFromSkills([guarded, open]);
    expect(consult(registry, "sub-task-dispatch", { hasProject: false }).map((s: KlimandSkill) => s.name)).toEqual(["open"]);
    expect(consult(registry, "sub-task-dispatch", { hasProject: true }).map((s: KlimandSkill) => s.name)).toEqual(["guarded", "open"]);
  });

  test("results are stable (sorted by name)", () => {
    const skills = [skill({ name: "zeta" }), skill({ name: "alpha" }), skill({ name: "mu" })];
    const registry = buildRegistryFromSkills(skills);
    expect(consult(registry, "sub-task-dispatch").map((s: KlimandSkill) => s.name)).toEqual(["alpha", "mu", "zeta"]);
  });

  test("missing trigger returns empty array, not undefined", () => {
    const registry = buildRegistryFromSkills([skill({ name: "x" })]);
    expect(consult(registry, "session-running")).toEqual([]);
  });
});

describe("renderConsultedSkills", () => {
  test("empty input renders empty string", () => {
    expect(renderConsultedSkills([], "sub-task-dispatch")).toBe("");
  });

  test("single skill includes name, source, body", () => {
    const out = renderConsultedSkills([skill({ name: "alpha", body: "do thing" })], "sub-task-dispatch");
    expect(out).toMatch(/Klimand skills/);
    expect(out).toMatch(/alpha/);
    expect(out).toMatch(/bundled/);
    expect(out).toMatch(/do thing/);
  });

  test("multiple skills separated by horizontal rules", () => {
    const out = renderConsultedSkills(
      [skill({ name: "a", body: "body-a" }), skill({ name: "b", body: "body-b" })],
      "sub-task-dispatch"
    );
    expect(out).toMatch(/body-a/);
    expect(out).toMatch(/body-b/);
    expect(out.match(/\n---\n/g)?.length).toBeGreaterThanOrEqual(1);
  });
});
