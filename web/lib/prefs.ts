import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const AgentPrefsSchema = z.object({
  routingHints: z.string().default(""),
  approval: z.enum(["auto", "ask"]).default("auto"),
  claude: z
    .object({
      model: z.string().optional(),
      permissionMode: z.enum(["bypassPermissions", "plan", "ask"]).optional(),
      extraArgs: z.string().optional()
    })
    .default({}),
  codex: z
    .object({
      model: z.string().optional(),
      sandboxMode: z.enum(["workspace-write", "read-only"]).optional(),
      extraArgs: z.string().optional()
    })
    .default({})
});

export type AgentPrefs = z.infer<typeof AgentPrefsSchema>;

export const DEFAULT_PREFS: AgentPrefs = AgentPrefsSchema.parse({});

function prefsDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "agentchain");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "agentchain");
}

export function prefsPath(): string {
  return path.join(prefsDir(), "prefs.json");
}

export async function getPrefs(): Promise<AgentPrefs> {
  try {
    const raw = await readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return AgentPrefsSchema.parse(parsed);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setPrefs(partial: Partial<AgentPrefs>): Promise<AgentPrefs> {
  const current = await getPrefs();
  const merged: AgentPrefs = {
    routingHints: partial.routingHints ?? current.routingHints,
    approval: partial.approval ?? current.approval,
    claude: { ...current.claude, ...(partial.claude ?? {}) },
    codex: { ...current.codex, ...(partial.codex ?? {}) }
  };
  const validated = AgentPrefsSchema.parse(merged);
  await mkdir(prefsDir(), { recursive: true });
  const finalPath = prefsPath();
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(validated, null, 2), "utf8");
  await rename(tmpPath, finalPath);
  return validated;
}
