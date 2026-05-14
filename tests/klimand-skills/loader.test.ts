import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { loadKlimandSkills } from "../../web/lib/klimand-skills/loader.js";
import type { KlimandSkill } from "../../web/lib/klimand-skills/types.js";

let root: string;
let bundledDir: string;
let userDir: string;
let projectDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "klimand-skills-"));
  bundledDir = path.join(root, "bundled");
  userDir = path.join(root, "user");
  projectDir = path.join(root, "project");
  await mkdir(bundledDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
  await mkdir(path.join(projectDir, ".klimand", "skills"), { recursive: true });
});

function skillMd(opts: { name: string; triggers?: string[]; description?: string; appliesWhen?: string; body?: string }): string {
  const triggers = opts.triggers ?? ["sub-task-dispatch"];
  const triggersLine = `[${triggers.map((t) => `'${t}'`).join(", ")}]`;
  const lines = [
    "---",
    `name: ${opts.name}`,
    `description: ${opts.description ?? "demo"}`,
    `triggers_on: ${triggersLine}`,
    opts.appliesWhen ? `applies_when: "${opts.appliesWhen}"` : null,
    'version: "0.1"',
    "---",
    "",
    opts.body ?? "body content"
  ].filter((s): s is string => s !== null);
  return lines.join("\n");
}

describe("loadKlimandSkills", () => {
  test("loads from a single bundled dir", async () => {
    await writeFile(path.join(bundledDir, "alpha.md"), skillMd({ name: "alpha" }));
    const result = await loadKlimandSkills({ bundledDir, userDir });
    expect(result.errors).toEqual([]);
    expect(result.skills.map((s: KlimandSkill) => s.name)).toEqual(["alpha"]);
    expect(result.skills[0]!.source.kind).toBe("bundled");
  });

  test("project overrides user overrides bundled by name", async () => {
    await writeFile(path.join(bundledDir, "shared.md"), skillMd({ name: "shared", description: "from-bundled" }));
    await writeFile(path.join(userDir, "shared.md"), skillMd({ name: "shared", description: "from-user" }));
    await writeFile(
      path.join(projectDir, ".klimand", "skills", "shared.md"),
      skillMd({ name: "shared", description: "from-project" })
    );
    const result = await loadKlimandSkills({ bundledDir, userDir, projectPath: projectDir });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.description).toBe("from-project");
    expect(result.skills[0]!.source.kind).toBe("project");
  });

  test("invalid frontmatter produces an error, not a thrown exception", async () => {
    await writeFile(path.join(bundledDir, "broken.md"), "---\nname: !!!badname\ndescription: x\ntriggers_on: ['sub-task-dispatch']\n---\nbody");
    const result = await loadKlimandSkills({ bundledDir, userDir });
    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/name/);
  });

  test("missing dirs return empty without erroring", async () => {
    const result = await loadKlimandSkills({ bundledDir: path.join(root, "nope"), userDir: path.join(root, "also-nope") });
    expect(result).toEqual({ skills: [], errors: [] });
  });

  test("empty body is rejected as an error", async () => {
    await writeFile(
      path.join(bundledDir, "empty.md"),
      "---\nname: empty\ndescription: x\ntriggers_on: ['sub-task-dispatch']\n---\n\n"
    );
    const result = await loadKlimandSkills({ bundledDir, userDir });
    expect(result.skills).toEqual([]);
    expect(result.errors[0]!.message).toMatch(/empty/);
  });

  test("ignores non-.md files", async () => {
    await writeFile(path.join(bundledDir, "notes.txt"), "not a skill");
    await writeFile(path.join(bundledDir, "alpha.md"), skillMd({ name: "alpha" }));
    const result = await loadKlimandSkills({ bundledDir, userDir });
    expect(result.skills.map((s: KlimandSkill) => s.name)).toEqual(["alpha"]);
  });

  test("sorts skills by name", async () => {
    await writeFile(path.join(bundledDir, "zeta.md"), skillMd({ name: "zeta" }));
    await writeFile(path.join(bundledDir, "alpha.md"), skillMd({ name: "alpha" }));
    await writeFile(path.join(bundledDir, "mu.md"), skillMd({ name: "mu" }));
    const result = await loadKlimandSkills({ bundledDir, userDir });
    expect(result.skills.map((s: KlimandSkill) => s.name)).toEqual(["alpha", "mu", "zeta"]);
  });
});
