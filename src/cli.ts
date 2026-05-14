#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { preflight } from "./preflight.js";
import { StateStore } from "./state.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const config = await loadConfig();
  config.stateDir = path.resolve(config.stateDir);
  const store = new StateStore(config.stateDir);
  await store.open();
  const audit = new AuditLog(config.stateDir);
  const orchestrator = new Orchestrator(config, store, audit);

  try {
    switch (command) {
      case "preflight": {
        const checks = await preflight(config, process.cwd());
        for (const check of checks) {
          console.log(`${check.level}\t${check.name}\t${check.detail}`);
        }
        process.exitCode = checks.some((check) => check.level === "fail") ? 1 : 0;
        break;
      }
      case "start": {
        const prompt = args[0];
        if (!prompt) usage("start requires a goal prompt");
        const workspace = readOption(args, "--workspace") ?? process.cwd();
        const goal = await orchestrator.createGoal(prompt, workspace);
        console.log(goal.id);
        break;
      }
      case "tick": {
        const goalId = readOption(args, "--goal") ?? args[0];
        if (!goalId) usage("tick requires --goal <goal-id>");
        const result = await orchestrator.tick(goalId);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "run": {
        const goalId = readOption(args, "--goal") ?? args[0];
        if (!goalId) usage("run requires --goal <goal-id>");
        const result = await orchestrator.run(goalId, args.includes("--watch"));
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "status": {
        const goalId = args[0] ?? readOption(args, "--goal");
        if (goalId) {
          const goal = store.getGoal(goalId);
          if (!goal) usage(`unknown goal: ${goalId}`);
          console.log(JSON.stringify({ goal, steps: store.getSteps(goalId) }, null, 2));
        } else {
          console.log(JSON.stringify(store.listGoals(), null, 2));
        }
        break;
      }
      case "logs": {
        const lines = Number(readOption(args, "--lines") ?? args[0] ?? 50);
        const text = await readFile(audit.file, "utf8").catch(() => "");
        const tail = text.trim().split(/\r?\n/).filter(Boolean).slice(-lines);
        console.log(tail.join("\n"));
        break;
      }
      case "stop": {
        const goalId = args[0] ?? readOption(args, "--goal");
        if (!goalId) usage("stop requires a goal id");
        store.updateGoalStatus(goalId, "stopped");
        console.log(`stopped ${goalId}`);
        break;
      }
      case "resume": {
        const goalId = args[0] ?? readOption(args, "--goal");
        if (!goalId) usage("resume requires a goal id");
        store.updateGoalStatus(goalId, "active");
        console.log(`resumed ${goalId}`);
        break;
      }
      case "dashboard": {
        const { renderDashboard } = await import("./ink/app.js");
        await renderDashboard({ store, orchestrator });
        return;
      }
      case "serve": {
        const { startServer } = await import("./server.js");
        const port = Number(readOption(args, "--port") ?? "7878");
        const host = readOption(args, "--host") ?? "127.0.0.1";
        const handle = await startServer({ store, orchestrator, audit, port, host });
        console.log(`klimand serve listening on http://${host}:${port}`);
        const shutdown = async () => {
          await handle.close();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        await new Promise(() => {});
        return;
      }
      case "web": {
        const { spawn } = await import("node:child_process");
        const webDir = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, "$1:"), "..", "..", "..", "web");
        const isWin = process.platform === "win32";
        const cmd = isWin ? "npm.cmd" : "npm";
        const child = spawn(cmd, ["run", "dev"], {
          cwd: webDir,
          stdio: "inherit",
          env: { ...process.env, KLIMAND_STATE_DIR: config.stateDir }
        });
        await new Promise<void>((resolve) => {
          child.on("close", () => resolve());
          process.on("SIGINT", () => child.kill("SIGTERM"));
          process.on("SIGTERM", () => child.kill("SIGTERM"));
        });
        return;
      }
      default:
        usage();
    }
  } finally {
    store.close();
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(`Usage:
  klimand preflight
  klimand start "<goal>" --workspace <dir>
  klimand tick --goal <goal-id>
  klimand run --goal <goal-id> [--watch]
  klimand status [goal-id]
  klimand logs [--lines 50]
  klimand stop <goal-id>
  klimand resume <goal-id>
  klimand dashboard
  klimand serve [--port 7878] [--host 127.0.0.1]
  klimand web`);
  process.exit(message ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
