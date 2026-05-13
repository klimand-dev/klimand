#!/usr/bin/env node
// Cross-platform fake CLI used by tests. Invoke via `node fake-cli.cjs ...`.
//
// Behavior controlled by env vars set on the spawned process:
//   FAKE_NAME              — label used in --version output and stdout session id.
//   FAKE_RESULTS_JSON      — JSON array of result-or-fail entries. Each entry is either
//                            an AgentResult object, or { "__fail__": "message" } to
//                            cause this invocation to exit with code 3.
//   FAKE_COUNTER_FILE      — path to a file holding the next invocation index. The fake
//                            reads it, picks RESULTS[min(idx, len-1)], increments,
//                            writes it back. Allows deterministic sequencing across
//                            spawn() calls without ordering races.
//
// Args understood:
//   --version              — print "<FAKE_NAME> fake 1.0.0" and exit 0.
//   -o <file>              — write the chosen result JSON to <file> (Codex-style).
//
// Stdin is drained but ignored.

const fs = require("node:fs");

const name = process.env.FAKE_NAME || "fake";
const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write(`${name} fake 1.0.0\n`);
  process.exit(0);
}

let outFile = null;
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "-o") outFile = args[i + 1];
}

let results;
try {
  results = JSON.parse(process.env.FAKE_RESULTS_JSON || "[]");
} catch {
  results = [];
}
if (!Array.isArray(results) || results.length === 0) {
  process.stderr.write(`${name}: FAKE_RESULTS_JSON missing or empty\n`);
  process.exit(2);
}

const counterFile = process.env.FAKE_COUNTER_FILE;
let idx = 0;
if (counterFile) {
  try {
    idx = Number(fs.readFileSync(counterFile, "utf8").trim()) || 0;
  } catch {
    idx = 0;
  }
}
const pick = results[Math.min(idx, results.length - 1)];
if (counterFile) {
  fs.writeFileSync(counterFile, String(idx + 1), "utf8");
}

// Drain stdin then act.
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  if (pick && pick.__fail__) {
    process.stderr.write(`${pick.__fail__}\n`);
    process.exit(3);
  }
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(pick));
  }
  process.stdout.write(`${JSON.stringify({ session_id: `${name}-session-${idx}`, result: pick })}\n`);
  process.exit(0);
});
