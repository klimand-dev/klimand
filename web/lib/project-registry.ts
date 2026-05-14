import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { validateProjectPath, ProjectPathError } from "./project-profile";
import { schedulePush } from "./sync-github";

export const ProjectEntrySchema = z.object({
  path: z.string(),
  label: z.string(),
  addedAt: z.string(),
  lastUsed: z.string()
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const ProjectRegistrySchema = z.object({
  approved: z.array(ProjectEntrySchema).default([]),
  hidden: z.array(z.string()).default([]),
  lastScan: z
    .object({
      at: z.string(),
      roots: z.array(z.string()),
      candidateCount: z.number()
    })
    .optional()
});
export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

const EMPTY_REGISTRY: ProjectRegistry = { approved: [], hidden: [] };

function prefsDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "klimand");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "klimand");
}

function registryPath(): string {
  return path.join(prefsDir(), "projects.json");
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

// Serialize read-modify-write through a single tail-chained promise pinned on
// globalThis so HMR-created module duplicates share the same lock.
interface RegistryGlobal {
  __klimand_registry_lock?: Promise<unknown>;
}
const g = globalThis as unknown as RegistryGlobal;

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__klimand_registry_lock ?? Promise.resolve();
  const next = prev.then(fn, fn);
  g.__klimand_registry_lock = next.catch(() => undefined);
  return next;
}

async function readRegistry(): Promise<ProjectRegistry> {
  try {
    const raw = await readFile(registryPath(), "utf8");
    const parsed = ProjectRegistrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_REGISTRY;
  } catch {
    return EMPTY_REGISTRY;
  }
}

async function writeRegistry(reg: ProjectRegistry): Promise<void> {
  const validated = ProjectRegistrySchema.parse(reg);
  await mkdir(prefsDir(), { recursive: true });
  const finalPath = registryPath();
  const tmp = `${finalPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(validated, null, 2), "utf8");
  await rename(tmp, finalPath);
  schedulePush();
}

export async function getRegistry(): Promise<ProjectRegistry> {
  return readRegistry();
}

export async function approveProject(input: string): Promise<ProjectEntry> {
  const abs = await validateProjectPath(input);
  return withLock(async () => {
    const reg = await readRegistry();
    reg.hidden = reg.hidden.filter((p) => p !== abs);
    const existing = reg.approved.find((e) => e.path === abs);
    const now = new Date().toISOString();
    if (existing) {
      existing.lastUsed = now;
      await writeRegistry(reg);
      return existing;
    }
    const entry: ProjectEntry = { path: abs, label: basename(abs) || abs, addedAt: now, lastUsed: now };
    reg.approved.push(entry);
    await writeRegistry(reg);
    return entry;
  });
}

export async function removeProject(input: string): Promise<void> {
  const abs = path.resolve(input);
  await withLock(async () => {
    const reg = await readRegistry();
    reg.approved = reg.approved.filter((e) => e.path !== abs);
    if (!reg.hidden.includes(abs)) reg.hidden.push(abs);
    await writeRegistry(reg);
  });
}

export async function hideProject(input: string): Promise<void> {
  const abs = path.resolve(input);
  await withLock(async () => {
    const reg = await readRegistry();
    reg.approved = reg.approved.filter((e) => e.path !== abs);
    if (!reg.hidden.includes(abs)) reg.hidden.push(abs);
    await writeRegistry(reg);
  });
}

export async function unhideProject(input: string): Promise<void> {
  const abs = path.resolve(input);
  await withLock(async () => {
    const reg = await readRegistry();
    reg.hidden = reg.hidden.filter((p) => p !== abs);
    await writeRegistry(reg);
  });
}

// Fire-and-forget bump: called from setThreadProject. Auto-approves new paths
// so the registry stays in sync with thread state. Validation failures are
// swallowed — never break a thread save because the registry can't accept the
// path (e.g., user manually wired an exotic path we don't yet recognize).
export async function touchProject(input: string): Promise<void> {
  let abs: string;
  try {
    abs = await validateProjectPath(input);
  } catch (e) {
    if (e instanceof ProjectPathError) return;
    throw e;
  }
  await withLock(async () => {
    const reg = await readRegistry();
    reg.hidden = reg.hidden.filter((p) => p !== abs);
    const now = new Date().toISOString();
    const existing = reg.approved.find((e) => e.path === abs);
    if (existing) {
      existing.lastUsed = now;
    } else {
      reg.approved.push({ path: abs, label: basename(abs) || abs, addedAt: now, lastUsed: now });
    }
    await writeRegistry(reg);
  });
}

export async function setLastScan(roots: string[], candidateCount: number): Promise<void> {
  await withLock(async () => {
    const reg = await readRegistry();
    reg.lastScan = { at: new Date().toISOString(), roots, candidateCount };
    await writeRegistry(reg);
  });
}
