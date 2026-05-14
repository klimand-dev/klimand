import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "./spawn";

export interface CliStatus {
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

export interface DoctorReport {
  claude: CliStatus;
  codex: CliStatus;
  checkedAt: string;
}

interface CacheSlot {
  report: DoctorReport;
  expiresAt: number;
}

const CACHE_TTL_MS = 5000;
const GLOBAL_KEY = "__klimand_doctor__";
const slot = globalThis as unknown as { [k: string]: CacheSlot | undefined };

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function probeVersion(cmd: string): Promise<CliStatus> {
  try {
    const result = await runCli(cmd, ["--version"], { timeoutMs: 3000 });
    if (result.exitCode !== 0) {
      return { installed: false, error: result.stderr.trim() || `exit ${result.exitCode}` };
    }
    const match = result.stdout.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/);
    const version = match ? match[0] : result.stdout.trim();
    return { installed: true, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { installed: false, error: message };
  }
}

async function claudeAuth(): Promise<boolean> {
  const home = os.homedir();
  return (
    (await exists(path.join(home, ".claude", ".credentials.json"))) ||
    (await exists(path.join(home, ".claude.json")))
  );
}

async function codexAuth(): Promise<boolean> {
  const home = os.homedir();
  return (
    (await exists(path.join(home, ".codex", "auth.json"))) ||
    (await exists(path.join(home, ".codex", "credentials.json")))
  );
}

async function build(): Promise<DoctorReport> {
  const [claudeVer, codexVer, cAuth, kAuth] = await Promise.all([
    probeVersion("claude"),
    probeVersion("codex"),
    claudeAuth(),
    codexAuth()
  ]);
  return {
    claude: { ...claudeVer, authenticated: claudeVer.installed ? cAuth : false },
    codex: { ...codexVer, authenticated: codexVer.installed ? kAuth : false },
    checkedAt: new Date().toISOString()
  };
}

export async function getDoctor(): Promise<DoctorReport> {
  const cached = slot[GLOBAL_KEY];
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  const report = await build();
  slot[GLOBAL_KEY] = { report, expiresAt: Date.now() + CACHE_TTL_MS };
  return report;
}

export async function refreshDoctor(): Promise<DoctorReport> {
  slot[GLOBAL_KEY] = undefined;
  return getDoctor();
}
