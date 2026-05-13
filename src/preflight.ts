import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { AgentChainConfig, ProviderName } from "./types.js";
import { runProcess } from "./process-runner.js";

export type PreflightLevel = "ok" | "warn" | "fail";

export interface PreflightCheck {
  name: string;
  level: PreflightLevel;
  detail: string;
}

export async function preflight(config: AgentChainConfig, cwd: string): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  checks.push(await checkNodeSqlite());
  checks.push(await checkWritable(cwd));
  checks.push(await checkProvider("codex", config));
  checks.push(await checkCodexAuth(config));
  checks.push(await checkProvider("claude", config));
  checks.push(checkBypassMode(config));
  checks.push(checkOpenAIKey());
  return checks;
}

function checkOpenAIKey(): PreflightCheck {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10) {
    return { name: "openai api key", level: "ok", detail: "set (required for the chat UI)" };
  }
  return {
    name: "openai api key",
    level: "warn",
    detail: "OPENAI_API_KEY not set — the chat UI will display a setup prompt instead of running the agent"
  };
}

async function checkNodeSqlite(): Promise<PreflightCheck> {
  try {
    await import("node:sqlite");
    return { name: "node:sqlite", level: "ok", detail: "available" };
  } catch (error) {
    return { name: "node:sqlite", level: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkCodexAuth(config: AgentChainConfig): Promise<PreflightCheck> {
  const command = config.providers.codex.command;
  try {
    const result = await runProcess(command, ["login", "status"], {
      cwd: process.cwd(),
      timeoutMs: 10000
    });
    return {
      name: "codex auth",
      level: result.code === 0 ? "ok" : "fail",
      detail: (result.stdout || result.stderr || `exit ${result.code}`).trim()
    };
  } catch (error) {
    return { name: "codex auth", level: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkWritable(cwd: string): Promise<PreflightCheck> {
  try {
    await access(cwd, constants.W_OK);
    return { name: "workspace writable", level: "ok", detail: cwd };
  } catch {
    return { name: "workspace writable", level: "fail", detail: cwd };
  }
}

async function checkProvider(provider: ProviderName, config: AgentChainConfig): Promise<PreflightCheck> {
  const command = config.providers[provider].command;
  try {
    const result = await runProcess(command, ["--version"], {
      cwd: process.cwd(),
      timeoutMs: 10000
    });
    return {
      name: `${provider} cli`,
      level: result.code === 0 ? "ok" : "fail",
      detail: (result.stdout || result.stderr || `exit ${result.code}`).trim()
    };
  } catch (error) {
    return { name: `${provider} cli`, level: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkBypassMode(config: AgentChainConfig): PreflightCheck {
  const bypasses: string[] = [];
  if (hasConsecutivePair(config.providers.codex.args, "--ask-for-approval", "never")) {
    bypasses.push("codex --ask-for-approval never");
  }
  if (hasConsecutivePair(config.providers.claude.args, "--permission-mode", "bypassPermissions")) {
    bypasses.push("claude --permission-mode bypassPermissions");
  }
  if (bypasses.length === 0) {
    return { name: "bypass mode", level: "ok", detail: "approval prompts enabled" };
  }
  return {
    name: "bypass mode",
    level: "warn",
    detail: `full automation enabled (${bypasses.join("; ")})`
  };
}

function hasConsecutivePair(args: string[], a: string, b: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === a && args[i + 1] === b) return true;
  }
  return false;
}
