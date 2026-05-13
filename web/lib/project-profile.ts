import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

// ---------------- Schema ----------------

const FileExcerptSchema = z.object({
  excerpt: z.string(),
  truncated: z.boolean(),
  bytes: z.number(),
  sha: z.string().optional()
});

const CommandSummarySchema = z.object({
  name: z.string(),
  description: z.string()
});

const AgentSummarySchema = z.object({
  name: z.string(),
  description: z.string()
});

const SkillSummarySchema = z.object({
  name: z.string(),
  description: z.string()
});

const McpServerSummarySchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "sse", "http", "unknown"]),
  commandHint: z.string().optional()
});

const HookSummarySchema = z.object({
  event: z.string(),
  matcher: z.string().optional(),
  count: z.number()
});

export const ProjectProfileSchema = z.object({
  schemaVersion: z.literal(1),
  projectPath: z.string(),
  scannedAt: z.string(),
  fingerprint: z.string(),
  claudeMd: FileExcerptSchema.nullable(),
  agentsMd: FileExcerptSchema.nullable(),
  codexConfig: z.object({ excerpt: z.string(), truncated: z.boolean(), bytes: z.number() }).nullable(),
  commands: z.array(CommandSummarySchema),
  agents: z.array(AgentSummarySchema),
  skills: z.array(SkillSummarySchema),
  mcpServers: z.array(McpServerSummarySchema),
  hooks: z.array(HookSummarySchema),
  warnings: z.array(z.string())
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

// ---------------- Errors ----------------

export type ProjectPathErrorKind = "not_absolute" | "not_found" | "not_a_directory" | "not_allowed" | "not_a_project";

export class ProjectPathError extends Error {
  constructor(public readonly kind: ProjectPathErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "ProjectPathError";
  }
}

// ---------------- Path validation ----------------

const WIN_BLOCKLIST = [/^C:\\Windows(\\|$)/i, /^C:\\Program Files( \(x86\))?(\\|$)/i, /^C:\\ProgramData(\\|$)/i];
const POSIX_BLOCKLIST = [
  /^\/etc(\/|$)/,
  /^\/usr(\/|$)/,
  /^\/bin(\/|$)/,
  /^\/sbin(\/|$)/,
  /^\/var(\/|$)/,
  /^\/System(\/|$)/,
  /^\/Library(\/|$)/,
  /^\/private(\/|$)/
];

function sensitiveHomeDirs(): string[] {
  const home = os.homedir();
  return [path.join(home, ".ssh"), path.join(home, ".aws")];
}

function agentchainStateDir(): string {
  if (process.env.AGENTCHAIN_STATE_DIR) return path.resolve(process.env.AGENTCHAIN_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".agentchain");
}

function isUnder(p: string, parent: string): boolean {
  const rel = path.relative(parent, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isBlockedPath(abs: string): boolean {
  if (process.platform === "win32") {
    if (WIN_BLOCKLIST.some((re) => re.test(abs))) return true;
  } else {
    if (POSIX_BLOCKLIST.some((re) => re.test(abs))) return true;
  }
  if (sensitiveHomeDirs().some((s) => isUnder(abs, s))) return true;
  if (isUnder(abs, agentchainStateDir())) return true;
  return false;
}

async function hasProjectMarker(abs: string): Promise<boolean> {
  const markers = ["CLAUDE.md", "AGENTS.md", ".claude", ".codex", ".mcp.json", "package.json", ".git"];
  for (const m of markers) {
    try {
      await stat(path.join(abs, m));
      return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

export async function validateProjectPath(input: string): Promise<string> {
  if (!input || typeof input !== "string") throw new ProjectPathError("not_absolute", "path required");
  if (!path.isAbsolute(input)) throw new ProjectPathError("not_absolute", `path must be absolute: ${input}`);
  const abs = path.resolve(input);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new ProjectPathError("not_found", `path does not exist: ${abs}`);
  }
  if (!st.isDirectory()) throw new ProjectPathError("not_a_directory", `path is not a directory: ${abs}`);
  if (isBlockedPath(abs)) throw new ProjectPathError("not_allowed", `path is blocklisted: ${abs}`);
  if (!(await hasProjectMarker(abs))) {
    throw new ProjectPathError(
      "not_a_project",
      `no project marker found in ${abs} (need one of CLAUDE.md, AGENTS.md, .claude, .codex, .mcp.json, package.json, .git)`
    );
  }
  return abs;
}

// ---------------- Limits ----------------

const READDIR_CAP = 250;
const SCAN_TIMEOUT_MS = 2000;
const CLAUDE_MD_BUDGET = 1800;
const AGENTS_MD_BUDGET = 800;
const CODEX_CONFIG_BUDGET = 400;
const COMMANDS_BUDGET = 400;
const AGENTS_BUDGET = 400;
const SKILLS_BUDGET = 300;
const MCP_BUDGET = 150;
const HOOKS_BUDGET = 80;

// ---------------- File reading helpers ----------------

async function readFileCapped(file: string, budget: number): Promise<{ excerpt: string; truncated: boolean; bytes: number; sha: string } | null> {
  try {
    const buf = await readFile(file);
    const bytes = buf.length;
    const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
    if (bytes <= budget) {
      return { excerpt: buf.toString("utf8"), truncated: false, bytes, sha };
    }
    // Truncate at a line boundary near the budget
    const slice = buf.subarray(0, budget).toString("utf8");
    const lastNl = slice.lastIndexOf("\n");
    const excerpt = lastNl > budget * 0.5 ? slice.slice(0, lastNl) : slice;
    return { excerpt, truncated: true, bytes, sha };
  } catch {
    return null;
  }
}

interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const block = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[m[1]!] = v;
  }
  return { data, body };
}

function clipDescription(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) return t;
  }
  return "";
}

// ---------------- Subscan: commands / agents ----------------

async function scanMarkdownDir(
  dir: string,
  warnings: string[]
): Promise<Array<{ name: string; description: string }>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  if (entries.length > READDIR_CAP) {
    warnings.push(`${path.basename(dir)}: ${entries.length} entries, capped at ${READDIR_CAP}`);
    entries = entries.slice(0, READDIR_CAP);
  }
  const out: Array<{ name: string; description: string }> = [];
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    try {
      const text = await readFile(path.join(dir, f), "utf8");
      const fm = parseFrontmatter(text);
      const name = fm.data["name"]?.trim() || f.replace(/\.md$/, "");
      const description = clipDescription(fm.data["description"] || firstNonEmptyLine(fm.body), 140);
      out.push({ name, description });
    } catch {
      /* skip unreadable */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function scanSkillsDir(dir: string, warnings: string[]): Promise<Array<{ name: string; description: string }>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  if (entries.length > READDIR_CAP) {
    warnings.push(`.claude/skills: ${entries.length} entries, capped at ${READDIR_CAP}`);
    entries = entries.slice(0, READDIR_CAP);
  }
  const out: Array<{ name: string; description: string }> = [];
  for (const entry of entries) {
    const child = path.join(dir, entry);
    try {
      const st = await stat(child);
      if (!st.isDirectory()) continue;
      const skillMd = path.join(child, "SKILL.md");
      let description = "";
      try {
        const text = await readFile(skillMd, "utf8");
        const fm = parseFrontmatter(text);
        description = clipDescription(fm.data["description"] || firstNonEmptyLine(fm.body), 200);
      } catch {
        /* skill dir without SKILL.md — keep description empty */
      }
      out.push({ name: entry, description });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------- Subscan: MCP servers ----------------

const ENV_REF_RE = /\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*/i;
const SECRET_RES: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/
];

function redactValue(v: string): { redacted: string; hit: boolean } {
  const envMatch = v.match(/^\$\{?([A-Z0-9_]+)\}?$/i);
  if (envMatch) return { redacted: `<env:${envMatch[1]}>`, hit: true };
  if (ENV_REF_RE.test(v)) return { redacted: v.replace(ENV_REF_RE, "<env>"), hit: true };
  for (const re of SECRET_RES) {
    if (re.test(v)) return { redacted: "<redacted>", hit: true };
  }
  if (v.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return { redacted: "<redacted>", hit: true };
  return { redacted: v, hit: false };
}

interface RawMcpServer {
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
}

async function scanMcpServers(
  projectRoot: string,
  warnings: string[]
): Promise<Array<{ name: string; transport: "stdio" | "sse" | "http" | "unknown"; commandHint?: string }>> {
  const file = path.join(projectRoot, ".mcp.json");
  let parsed: unknown;
  try {
    const raw = await readFile(file, "utf8");
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT")) return [];
    warnings.push(`.mcp.json: ${msg}`);
    return [];
  }
  // shape: { mcpServers: { name: { command, args, env, url, type } } }
  const servers: Record<string, RawMcpServer> = {};
  if (parsed && typeof parsed === "object") {
    const p = parsed as { mcpServers?: unknown; servers?: unknown };
    const candidate = (p.mcpServers ?? p.servers) as unknown;
    if (candidate && typeof candidate === "object") {
      for (const [name, v] of Object.entries(candidate as Record<string, unknown>)) {
        if (v && typeof v === "object") servers[name] = v as RawMcpServer;
      }
    }
  }
  let redactionCount = 0;
  const out: Array<{ name: string; transport: "stdio" | "sse" | "http" | "unknown"; commandHint?: string }> = [];
  for (const [name, cfg] of Object.entries(servers)) {
    let transport: "stdio" | "sse" | "http" | "unknown" = "unknown";
    const tHint = (cfg.transport || cfg.type || "").toLowerCase();
    if (tHint === "stdio") transport = "stdio";
    else if (tHint === "sse") transport = "sse";
    else if (tHint === "http" || tHint === "streamable-http") transport = "http";
    else if (cfg.url) transport = "http";
    else if (cfg.command) transport = "stdio";
    let commandHint: string | undefined;
    if (cfg.command) {
      const cmd = redactValue(cfg.command);
      if (cmd.hit) redactionCount++;
      const args = Array.isArray(cfg.args)
        ? cfg.args.slice(0, 4).map((a) => {
            const r = redactValue(String(a));
            if (r.hit) redactionCount++;
            return r.redacted;
          })
        : [];
      const joined = [cmd.redacted, ...args].join(" ");
      commandHint = joined.length > 80 ? `${joined.slice(0, 77)}…` : joined;
    } else if (cfg.url) {
      const u = redactValue(cfg.url);
      if (u.hit) redactionCount++;
      commandHint = u.redacted.length > 80 ? `${u.redacted.slice(0, 77)}…` : u.redacted;
    }
    out.push({ name, transport, ...(commandHint ? { commandHint } : {}) });
  }
  if (redactionCount > 0) warnings.push(`.mcp.json: ${redactionCount} values redacted (env vars or secret-like)`);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------- Subscan: hooks ----------------

async function scanHooks(projectRoot: string, warnings: string[]): Promise<Array<{ event: string; matcher?: string; count: number }>> {
  const aggregate = new Map<string, number>();
  for (const fname of ["settings.json", "settings.local.json"]) {
    const file = path.join(projectRoot, ".claude", fname);
    let parsed: unknown;
    try {
      const raw = await readFile(file, "utf8");
      parsed = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("ENOENT")) warnings.push(`.claude/${fname}: ${msg}`);
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const hooks = (parsed as { hooks?: unknown }).hooks;
    if (!hooks || typeof hooks !== "object") continue;
    for (const [event, matchers] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers as Array<{ matcher?: string; hooks?: unknown[] }>) {
        const matcher = typeof m.matcher === "string" ? m.matcher : undefined;
        const count = Array.isArray(m.hooks) ? m.hooks.length : 1;
        const key = matcher ? `${event}::${matcher}` : event;
        aggregate.set(key, (aggregate.get(key) ?? 0) + count);
      }
    }
  }
  const out: Array<{ event: string; matcher?: string; count: number }> = [];
  for (const [key, count] of aggregate.entries()) {
    const [event, matcher] = key.includes("::") ? key.split("::") : [key, undefined];
    out.push({ event: event!, ...(matcher ? { matcher } : {}), count });
  }
  out.sort((a, b) => (a.event === b.event ? (a.matcher || "").localeCompare(b.matcher || "") : a.event.localeCompare(b.event)));
  return out;
}

// ---------------- Fingerprint ----------------

interface FpEntry {
  rel: string;
  size: number;
  mtimeMs: number;
}

async function statIfExists(p: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(p);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

async function fingerprintProject(root: string): Promise<string> {
  const entries: FpEntry[] = [];
  async function statFile(rel: string): Promise<void> {
    const s = await statIfExists(path.join(root, rel));
    if (s) entries.push({ rel, ...s });
  }
  await Promise.all([
    statFile("CLAUDE.md"),
    statFile("AGENTS.md"),
    statFile(".mcp.json"),
    statFile(".claude/settings.json"),
    statFile(".claude/settings.local.json"),
    statFile(".codex/config.toml")
  ]);
  for (const sub of ["commands", "agents"]) {
    const dir = path.join(root, ".claude", sub);
    try {
      const files = await readdir(dir);
      if (files.length > READDIR_CAP) {
        // Don't stat every one — use dir mtime as the signal
        const s = await statIfExists(dir);
        if (s) entries.push({ rel: `.claude/${sub}/[capped:${files.length}]`, ...s });
      } else {
        for (const f of files) {
          if (!f.endsWith(".md")) continue;
          const s = await statIfExists(path.join(dir, f));
          if (s) entries.push({ rel: `.claude/${sub}/${f}`, ...s });
        }
      }
    } catch {
      /* missing */
    }
  }
  // Skills: shallow, then SKILL.md
  const skillsDir = path.join(root, ".claude", "skills");
  try {
    const skills = await readdir(skillsDir);
    if (skills.length > READDIR_CAP) {
      const s = await statIfExists(skillsDir);
      if (s) entries.push({ rel: `.claude/skills/[capped:${skills.length}]`, ...s });
    } else {
      for (const sk of skills) {
        const s = await statIfExists(path.join(skillsDir, sk, "SKILL.md"));
        if (s) entries.push({ rel: `.claude/skills/${sk}/SKILL.md`, ...s });
      }
    }
  } catch {
    /* missing */
  }
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return hash.slice(0, 16);
}

// ---------------- Main scan ----------------

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(onTimeout());
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(onTimeout());
      }
    );
  });
}

async function scanProjectInner(projectPath: string): Promise<ProjectProfile> {
  const warnings: string[] = [];
  const [claudeMd, agentsMd, codexConfigFile, commands, agents, skills, mcpServers, hooks, fingerprint] = await Promise.all([
    readFileCapped(path.join(projectPath, "CLAUDE.md"), CLAUDE_MD_BUDGET),
    readFileCapped(path.join(projectPath, "AGENTS.md"), AGENTS_MD_BUDGET),
    readFileCapped(path.join(projectPath, ".codex", "config.toml"), CODEX_CONFIG_BUDGET),
    scanMarkdownDir(path.join(projectPath, ".claude", "commands"), warnings),
    scanMarkdownDir(path.join(projectPath, ".claude", "agents"), warnings),
    scanSkillsDir(path.join(projectPath, ".claude", "skills"), warnings),
    scanMcpServers(projectPath, warnings),
    scanHooks(projectPath, warnings),
    fingerprintProject(projectPath)
  ]);
  return {
    schemaVersion: 1,
    projectPath,
    scannedAt: new Date().toISOString(),
    fingerprint,
    claudeMd,
    agentsMd,
    codexConfig: codexConfigFile ? { excerpt: codexConfigFile.excerpt, truncated: codexConfigFile.truncated, bytes: codexConfigFile.bytes } : null,
    commands,
    agents,
    skills,
    mcpServers,
    hooks,
    warnings
  };
}

export async function scanProject(input: string): Promise<ProjectProfile> {
  const projectPath = await validateProjectPath(input);
  return withTimeout(scanProjectInner(projectPath), SCAN_TIMEOUT_MS, () => ({
    schemaVersion: 1 as const,
    projectPath,
    scannedAt: new Date().toISOString(),
    fingerprint: "timeout",
    claudeMd: null,
    agentsMd: null,
    codexConfig: null,
    commands: [],
    agents: [],
    skills: [],
    mcpServers: [],
    hooks: [],
    warnings: [`scan timed out at ${SCAN_TIMEOUT_MS}ms`]
  }));
}

// ---------------- Digest renderer ----------------

function listSection(
  heading: string,
  items: Array<{ name: string; description?: string }>,
  budget: number,
  showDesc = true
): string {
  if (items.length === 0) return "";
  const lines: string[] = [`### ${heading} (${items.length})`];
  let used = lines[0]!.length + 1;
  let included = 0;
  for (const it of items) {
    const line = showDesc && it.description ? `- ${it.name} — ${it.description}` : `- ${it.name}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1;
    included++;
  }
  if (included < items.length) {
    const tail = `- (+${items.length - included} more)`;
    if (used + tail.length + 1 <= budget) lines.push(tail);
    else lines[lines.length - 1] = `- (+${items.length - included + 1} more)`;
  }
  return lines.join("\n");
}

function fileSection(heading: string, file: { excerpt: string; truncated: boolean; bytes: number } | null): string {
  if (!file) return "";
  const sizeLabel = file.truncated
    ? `(first ${Math.min(file.bytes, file.excerpt.length)} B of ${(file.bytes / 1024).toFixed(1)} KB, truncated)`
    : `(full, ${file.bytes} B)`;
  return `### ${heading} ${sizeLabel}\n${file.excerpt.trim()}`;
}

function mcpSection(servers: Array<{ name: string; transport: string }>, budget: number): string {
  if (servers.length === 0) return "";
  const head = `### MCP servers (${servers.length})`;
  const body = servers.map((s) => `${s.name} (${s.transport})`).join(", ");
  const full = `${head}\n${body}`;
  if (full.length <= head.length + 1 + budget) return full;
  const trimmed = body.slice(0, budget - 16).replace(/, [^,]*$/, "");
  return `${head}\n${trimmed}, +more`;
}

function hooksSection(hooks: Array<{ event: string; matcher?: string; count: number }>): string {
  if (hooks.length === 0) return "";
  const byEvent = new Map<string, number>();
  for (const h of hooks) byEvent.set(h.event, (byEvent.get(h.event) ?? 0) + h.count);
  const parts = Array.from(byEvent.entries()).map(([e, n]) => `${e}×${n}`);
  return `### Hooks\n${parts.join(", ")}`;
}

export function digestProfile(profile: ProjectProfile): string {
  const present: string[] = [];
  const absent: string[] = [];
  if (profile.claudeMd) present.push("CLAUDE.md");
  else absent.push("CLAUDE.md");
  if (profile.agentsMd) present.push("AGENTS.md");
  else absent.push("AGENTS.md");
  if (profile.commands.length > 0) present.push(`.claude/commands (${profile.commands.length})`);
  if (profile.agents.length > 0) present.push(`.claude/agents (${profile.agents.length})`);
  if (profile.skills.length > 0) present.push(`.claude/skills (${profile.skills.length})`);
  if (profile.mcpServers.length > 0) present.push(`.mcp.json (${profile.mcpServers.length} servers)`);
  if (profile.hooks.length > 0) present.push(".claude/settings hooks");
  if (profile.codexConfig) present.push(".codex/config.toml");

  const sections: string[] = [];
  sections.push(`## Target project context\n\nPath: ${profile.projectPath}\nScanned: ${profile.scannedAt} (fingerprint ${profile.fingerprint})`);

  if (present.length === 0) {
    sections.push("No Claude/Codex configuration detected. The project has none of: CLAUDE.md, AGENTS.md, .claude/, .codex/, .mcp.json. Treat the project as a plain workspace.");
    return sections.join("\n\n");
  }

  const fileBlocks: string[] = [];
  const claudeMdBlock = fileSection("CLAUDE.md", profile.claudeMd);
  if (claudeMdBlock) fileBlocks.push(claudeMdBlock);
  const agentsMdBlock = fileSection("AGENTS.md", profile.agentsMd);
  if (agentsMdBlock) fileBlocks.push(agentsMdBlock);
  const codexBlock = profile.codexConfig
    ? `### .codex/config.toml ${profile.codexConfig.truncated ? "(truncated)" : "(full)"}\n${profile.codexConfig.excerpt.trim()}`
    : "";
  if (codexBlock) fileBlocks.push(codexBlock);
  if (fileBlocks.length > 0) sections.push(fileBlocks.join("\n\n"));

  const listBlocks: string[] = [];
  const cmdBlock = listSection("Slash commands", profile.commands, COMMANDS_BUDGET, true);
  if (cmdBlock) listBlocks.push(cmdBlock);
  const agentBlock = listSection("Subagents", profile.agents, AGENTS_BUDGET, true);
  if (agentBlock) listBlocks.push(agentBlock);
  const skillBlock = listSection("Skills", profile.skills, SKILLS_BUDGET, true);
  if (skillBlock) listBlocks.push(skillBlock);
  const mcp = mcpSection(profile.mcpServers, MCP_BUDGET);
  if (mcp) listBlocks.push(mcp);
  const hk = hooksSection(profile.hooks);
  if (hk) listBlocks.push(hk);
  if (listBlocks.length > 0) sections.push(listBlocks.join("\n\n"));

  if (absent.length > 0) sections.push(`Not present: ${absent.join(", ")}`);
  if (profile.warnings.length > 0) sections.push(`### Warnings\n${profile.warnings.map((w) => `- ${w}`).join("\n")}`);

  return sections.join("\n\n");
}

// ---------------- Cache ----------------

interface CacheEntry {
  fingerprint: string;
  scannedAt: number;
  lastCheckedAt: number;
  profile: ProjectProfile;
  digest: string;
}

const G = globalThis as unknown as { __agentchainProfileCache?: Map<string, CacheEntry> };
function cacheMap(): Map<string, CacheEntry> {
  if (!G.__agentchainProfileCache) G.__agentchainProfileCache = new Map();
  return G.__agentchainProfileCache;
}

const FRESH_MS = 5_000;
const MAX_AGE_MS = 5 * 60_000;

export async function getProfile(projectPath: string): Promise<{ profile: ProjectProfile; digest: string }> {
  const abs = await validateProjectPath(projectPath);
  const key = abs;
  const now = Date.now();
  const cache = cacheMap();
  const hit = cache.get(key);
  if (hit && now - hit.lastCheckedAt < FRESH_MS) return { profile: hit.profile, digest: hit.digest };
  let fp = "";
  try {
    fp = await fingerprintProject(abs);
  } catch {
    /* fingerprint best-effort; on failure force a rescan */
  }
  if (hit && fp && fp === hit.fingerprint && now - hit.scannedAt < MAX_AGE_MS) {
    hit.lastCheckedAt = now;
    return { profile: hit.profile, digest: hit.digest };
  }
  const profile = await scanProject(abs);
  const digest = digestProfile(profile);
  cache.set(key, { fingerprint: profile.fingerprint, scannedAt: now, lastCheckedAt: now, profile, digest });
  return { profile, digest };
}

export async function invalidateProfile(projectPath: string): Promise<void> {
  try {
    const abs = path.resolve(projectPath);
    cacheMap().delete(abs);
  } catch {
    /* swallow */
  }
}
