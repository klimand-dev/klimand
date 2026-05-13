import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { preflight } from "../src/preflight.js";
import { AgentChainConfig } from "../src/types.js";

const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cli.cjs");

function makeConfig(stateDir: string, providerArgs: { claude?: string[]; codex?: string[] } = {}): AgentChainConfig {
  return {
    stateDir,
    maxCycles: 1,
    stepTimeoutMs: 1000,
    maxRetries: 0,
    providers: {
      claude: {
        command: "node",
        args: [FAKE_CLI, ...(providerArgs.claude ?? [])],
        env: { FAKE_NAME: "claude", FAKE_RESULTS_JSON: "[{\"status\":\"continue\",\"summary\":\"x\"}]" }
      },
      codex: {
        command: "node",
        args: [FAKE_CLI, ...(providerArgs.codex ?? [])],
        env: { FAKE_NAME: "codex", FAKE_RESULTS_JSON: "[{\"status\":\"continue\",\"summary\":\"x\"}]" }
      }
    }
  };
}

test("preflight reports provider availability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentchain-preflight-"));
  const config = makeConfig(path.join(root, ".agentchain"));
  const checks = await preflight(config, root);
  expect(checks.find((c) => c.name === "node:sqlite")?.level).toBe("ok");
  expect(checks.find((c) => c.name === "claude cli")?.level).toBe("ok");
  expect(checks.find((c) => c.name === "codex cli")?.level).toBe("ok");
});

test("preflight emits warn when bypass mode is on", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentchain-preflight-warn-"));
  const config = makeConfig(path.join(root, ".agentchain"), {
    codex: ["--ask-for-approval", "never"],
    claude: ["--permission-mode", "bypassPermissions"]
  });
  const checks = await preflight(config, root);
  const bypass = checks.find((c) => c.name === "bypass mode");
  expect(bypass?.level).toBe("warn");
  expect(bypass?.detail).toContain("codex");
  expect(bypass?.detail).toContain("claude");
});

test("preflight reports ok bypass mode when approval prompts enabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentchain-preflight-ok-"));
  const config = makeConfig(path.join(root, ".agentchain"));
  const checks = await preflight(config, root);
  expect(checks.find((c) => c.name === "bypass mode")?.level).toBe("ok");
});
