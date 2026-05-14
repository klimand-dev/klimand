import { access } from "node:fs/promises";
import path from "node:path";
import { KlimandConfig } from "./types.js";
import { readJson } from "./util.js";

const defaults: KlimandConfig = {
  stateDir: ".klimand",
  maxCycles: 8,
  stepTimeoutMs: 30 * 60 * 1000,
  maxRetries: 1,
  providers: {
    codex: {
      command: "codex",
      args: ["exec", "--json", "--ask-for-approval", "never"]
    },
    claude: {
      command: "claude",
      args: ["-p", "--output-format", "stream-json", "--permission-mode", "bypassPermissions"]
    }
  }
};

export async function loadConfig(cwd = process.cwd()): Promise<KlimandConfig> {
  const file = path.join(cwd, "klimand.config.json");
  try {
    await access(file);
    const local = await readJson<Partial<KlimandConfig>>(file);
    return {
      ...defaults,
      ...local,
      providers: {
        ...defaults.providers,
        ...(local.providers ?? {})
      }
    };
  } catch {
    return defaults;
  }
}
