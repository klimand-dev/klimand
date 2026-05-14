#!/usr/bin/env node
// Klimand zero-install entrypoint.
//
// On first run inside a fresh clone (or `npx`-style install), this:
//   1. Resolves the bundled `web/` directory.
//   2. Ensures dependencies are installed (`npm install` if `node_modules` is missing).
//   3. Builds once if there is no `.next` build output.
//   4. Runs `next start` and opens the browser to the local URL.
//
// Flags:
//   --dev           Run `next dev` (auto-reload) instead of `next start`.
//   --port <n>      Override the listening port (default 3000).
//   --no-open       Don't open a browser tab.
//   --help, -h      Show this help.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const flags = new Set(args);
if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

const dev = flags.has("--dev");
const noOpen = flags.has("--no-open");
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? args[portIdx + 1] : process.env.PORT || "3000";

const webDir = resolveWebDir();
if (!webDir) {
  console.error("[klimand] could not locate the web/ directory.");
  console.error("[klimand] try running from inside a cloned klimand repository, or use the published npm package.");
  process.exit(1);
}

await ensureInstalled(webDir);
if (!dev) await ensureBuilt(webDir);

const url = `http://localhost:${port}`;
console.log(`[klimand] starting Klimand at ${url} ...`);
if (!noOpen) {
  // Defer slightly so the server has a moment to bind before we open a tab.
  setTimeout(() => openBrowser(url), 1500);
}

const command = dev ? "dev" : "start";
const child = spawn(npmCmd(), ["run", command, "--", "--port", String(port)], {
  cwd: webDir,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

function resolveWebDir() {
  // Search candidates in order: env override, sibling /web in the package tree,
  // a cloned repo with web/, ./web in the current working directory.
  const envOverride = process.env.KLIMAND_WEB_DIR;
  if (envOverride && existsSync(join(envOverride, "package.json"))) return resolve(envOverride);

  const candidates = [
    join(__dirname, "..", "..", "web"), // installed alongside cli/
    join(__dirname, "..", "web"),
    resolve(process.cwd(), "web"),
    resolve(process.cwd())
  ];
  for (const c of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(c, "package.json"), "utf8"));
      if (pkg && (pkg.name === "klimand-web" || pkg.dependencies?.next)) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function npmCmd() {
  return platform() === "win32" ? "npm.cmd" : "npm";
}

async function ensureInstalled(dir) {
  if (existsSync(join(dir, "node_modules"))) return;
  console.log("[klimand] installing dependencies (first run only)...");
  await runOnce(npmCmd(), ["install", "--no-audit", "--no-fund"], dir);
}

async function ensureBuilt(dir) {
  if (existsSync(join(dir, ".next"))) return;
  console.log("[klimand] building production bundle (first run only)...");
  await runOnce(npmCmd(), ["run", "build"], dir);
}

function runOnce(cmd, args, cwd) {
  return new Promise((resolveP, rejectP) => {
    const c = spawn(cmd, args, { cwd, stdio: "inherit", shell: false });
    c.on("exit", (code) => (code === 0 ? resolveP() : rejectP(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    c.on("error", rejectP);
  });
}

function openBrowser(url) {
  const p = platform();
  try {
    if (p === "win32") spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (p === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* swallow — opening a browser is best-effort */
  }
}

function printHelp() {
  console.log(`klimand — local orchestrator for Claude Code + Codex

Usage:
  npx klimand [options]

Options:
  --dev            Run the dev server with auto-reload.
  --port <n>       Listen on a specific port (default 3000).
  --no-open        Don't open a browser tab on start.
  -h, --help       Show this help.

Environment:
  KLIMAND_WEB_DIR   Override the path to the web/ directory.
  KLIMAND_STATE_DIR Override where state is stored (audit log, threads).
  OPENAI_API_KEY       Optional — can also be pasted in Settings.
`);
}
