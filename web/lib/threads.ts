import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { touchProject } from "./project-registry";
import { schedulePush } from "./sync-github";
import { atomicWrite as atomicWriteFile } from "./atomic-write";

export const ThreadKindSchema = z.enum(["chat", "scheduled"]);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: ThreadKindSchema,
  scheduleId: z.string().optional(),
  sandbox: z.string(),
  projectPath: z.string().optional(),
  context: z.string().optional(),
  createdAt: z.string(),
  lastTouched: z.string()
});
export type Thread = z.infer<typeof ThreadSchema>;

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

function threadsDir(): string {
  return path.join(stateDir(), "threads");
}

function threadFile(id: string): string {
  return path.join(threadsDir(), `${id}.json`);
}

function newId(): string {
  return randomBytes(8).toString("hex");
}

function newSandboxPath(): string {
  return path.join(os.tmpdir(), "klimand-sandboxes", `sb-${randomBytes(4).toString("hex")}`);
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await atomicWriteFile(file, content);
  schedulePush();
}

export async function listThreads(): Promise<Thread[]> {
  try {
    await mkdir(threadsDir(), { recursive: true });
    const files = await readdir(threadsDir());
    const out: Thread[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(threadsDir(), f), "utf8");
        const parsed = ThreadSchema.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip unreadable */
      }
    }
    out.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
    return out;
  } catch {
    return [];
  }
}

export async function getThread(id: string): Promise<Thread | null> {
  try {
    const raw = await readFile(threadFile(id), "utf8");
    const parsed = ThreadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function createThread(input: {
  title?: string;
  kind?: ThreadKind;
  scheduleId?: string;
  context?: string;
  projectPath?: string;
}): Promise<Thread> {
  const now = new Date().toISOString();
  const thread: Thread = {
    id: newId(),
    title: input.title ?? defaultTitle(input.kind ?? "chat"),
    kind: input.kind ?? "chat",
    ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    sandbox: newSandboxPath(),
    createdAt: now,
    lastTouched: now
  };
  await atomicWrite(threadFile(thread.id), JSON.stringify(thread, null, 2));
  if (input.projectPath) {
    void touchProject(input.projectPath).catch(() => undefined);
  }
  return thread;
}

function defaultTitle(kind: ThreadKind): string {
  const stamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return kind === "scheduled" ? `Schedule ${stamp}` : `New chat ${stamp}`;
}

export async function updateThread(
  id: string,
  partial: Partial<Pick<Thread, "title" | "lastTouched" | "sandbox" | "scheduleId" | "projectPath">>
): Promise<Thread | null> {
  const existing = await getThread(id);
  if (!existing) return null;
  const updated: Thread = { ...existing, ...partial };
  await atomicWrite(threadFile(id), JSON.stringify(updated, null, 2));
  return updated;
}

export async function setThreadProject(id: string, projectPath: string | null): Promise<Thread | null> {
  const existing = await getThread(id);
  if (!existing) return null;
  const next: Thread = { ...existing };
  if (projectPath === null) delete next.projectPath;
  else next.projectPath = projectPath;
  next.lastTouched = new Date().toISOString();
  await atomicWrite(threadFile(id), JSON.stringify(next, null, 2));
  if (projectPath) {
    void touchProject(projectPath).catch(() => undefined);
  }
  return next;
}

export async function touchThread(id: string): Promise<void> {
  await updateThread(id, { lastTouched: new Date().toISOString() });
}

export async function deleteThread(id: string): Promise<boolean> {
  try {
    await unlink(threadFile(id));
    return true;
  } catch {
    return false;
  }
}

export async function rotateThreadSandbox(id: string): Promise<Thread | null> {
  return updateThread(id, { sandbox: newSandboxPath(), lastTouched: new Date().toISOString() });
}

export async function getOrCreateDefaultThread(): Promise<Thread> {
  const list = await listThreads();
  const chat = list.find((t) => t.kind === "chat");
  if (chat) return chat;
  return createThread({ title: "Default chat", kind: "chat" });
}
