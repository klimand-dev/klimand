import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  KlimandSkillFrontmatterSchema,
  type KlimandSkill,
  type KlimandSkillLoadError,
  type KlimandSkillLoadResult,
  type KlimandSkillSource
} from "./types";

const READDIR_CAP = 250;

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const block = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let raw = m[2]!.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      data[key] = inner.length === 0
        ? []
        : inner
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter((s) => s.length > 0);
      continue;
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    data[key] = raw;
  }
  return { data, body };
}

async function readSkillFile(filePath: string, source: KlimandSkillSource): Promise<KlimandSkill | KlimandSkillLoadError> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (e) {
    return { path: filePath, source: source.kind, message: e instanceof Error ? e.message : String(e) };
  }
  const fm = parseFrontmatter(text);
  const parsed = KlimandSkillFrontmatterSchema.safeParse({
    name: fm.data["name"],
    description: fm.data["description"],
    triggers_on: fm.data["triggers_on"],
    applies_when: fm.data["applies_when"],
    version: fm.data["version"] ?? "0.1"
  });
  if (!parsed.success) {
    return {
      path: filePath,
      source: source.kind,
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")
    };
  }
  const body = fm.body.trim();
  if (body.length === 0) {
    return { path: filePath, source: source.kind, message: "skill body is empty" };
  }
  const fmData = parsed.data;
  const skill: KlimandSkill = {
    name: fmData.name,
    description: fmData.description,
    triggers: fmData.triggers_on,
    version: fmData.version,
    body,
    source: { kind: source.kind, path: filePath }
  };
  if (fmData.applies_when !== undefined) {
    skill.appliesWhen = fmData.applies_when;
  }
  return skill;
}

async function scanSkillDir(
  dir: string,
  sourceKind: KlimandSkillSource["kind"]
): Promise<KlimandSkillLoadResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { skills: [], errors: [] };
  }
  if (entries.length > READDIR_CAP) entries = entries.slice(0, READDIR_CAP);
  const skills: KlimandSkill[] = [];
  const errors: KlimandSkillLoadError[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    let st;
    try {
      st = await stat(filePath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const result = await readSkillFile(filePath, { kind: sourceKind, path: filePath });
    if ("triggers" in result) skills.push(result);
    else errors.push(result);
  }
  return { skills, errors };
}

function bundledSkillsDir(): string {
  // KLIMAND_BUNDLED_SKILLS_DIR is the override; otherwise resolve relative to the
  // Next.js process cwd, which lives in <repo>/web/ during development and the
  // built output for production. The bundled pack always lives at <repo>/klimand/skills/base.
  if (process.env.KLIMAND_BUNDLED_SKILLS_DIR) return path.resolve(process.env.KLIMAND_BUNDLED_SKILLS_DIR);
  return path.resolve(process.cwd(), "..", "klimand", "skills", "base");
}

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

export interface LoadKlimandSkillsOptions {
  projectPath?: string | null;
  bundledDir?: string;
  userDir?: string;
}

/**
 * Load Klimand skills from the three layered sources:
 *   1. bundled base pack   — klimand/skills/base/
 *   2. user-level skills   — <stateDir>/skills/
 *   3. project-local       — <projectPath>/.klimand/skills/
 *
 * Later sources override earlier ones by skill name.
 */
export async function loadKlimandSkills(opts: LoadKlimandSkillsOptions = {}): Promise<KlimandSkillLoadResult> {
  const bundled = opts.bundledDir ?? bundledSkillsDir();
  const user = opts.userDir ?? path.join(stateDir(), "skills");
  const project = opts.projectPath ? path.join(opts.projectPath, ".klimand", "skills") : null;

  const layers: Array<{ dir: string; kind: KlimandSkillSource["kind"] }> = [
    { dir: bundled, kind: "bundled" },
    { dir: user, kind: "user" }
  ];
  if (project) layers.push({ dir: project, kind: "project" });

  const merged = new Map<string, KlimandSkill>();
  const errors: KlimandSkillLoadError[] = [];
  for (const { dir, kind } of layers) {
    const result = await scanSkillDir(dir, kind);
    for (const skill of result.skills) merged.set(skill.name, skill);
    errors.push(...result.errors);
  }
  const skills = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { skills, errors };
}
