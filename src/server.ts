import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { StateStore } from "./state.js";
import { Orchestrator } from "./orchestrator.js";
import { AuditLog } from "./audit.js";
import { getGoalThread, listGoalThreads } from "./ink/adapter.js";
import type { Goal } from "./types.js";

interface SseClient {
  res: ServerResponse;
  alive: boolean;
}

export interface ServeOptions {
  store: StateStore;
  orchestrator: Orchestrator;
  audit: AuditLog;
  port: number;
  host: string;
}

const ALLOWED_CORS_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

export async function startServer(opts: ServeOptions): Promise<{ close: () => Promise<void> }> {
  const sseClients = new Set<SseClient>();
  const goalSnapshot = new Map<string, { status: Goal["status"]; cycle: number }>();

  // Seed snapshot so the first poll doesn't emit spurious events.
  for (const g of opts.store.listGoals()) {
    goalSnapshot.set(g.id, { status: g.status, cycle: g.cycle });
  }

  const broadcast = (event: Record<string, unknown>) => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      if (!client.alive) continue;
      try {
        client.res.write(line);
      } catch {
        client.alive = false;
      }
    }
  };

  // 1) In-process events from this Orchestrator (when the same process is running goals).
  opts.orchestrator.events.on("goal_created", (e: { goal: Goal }) =>
    broadcast({ type: "goal_created", goalId: e.goal.id })
  );
  opts.orchestrator.events.on("goal_status", (e: { goalId: string; status: Goal["status"]; cycle: number }) => {
    broadcast({ type: "goal_status", goalId: e.goalId, status: e.status, cycle: e.cycle });
    goalSnapshot.set(e.goalId, { status: e.status, cycle: e.cycle });
  });
  opts.orchestrator.events.on("step_started", (e: { goalId: string; step: { id: string } }) =>
    broadcast({ type: "step_started", goalId: e.goalId, stepId: e.step.id })
  );
  opts.orchestrator.events.on("step_finished", (e: { goalId: string; stepId: string }) =>
    broadcast({ type: "step_finished", goalId: e.goalId, stepId: e.stepId })
  );
  opts.orchestrator.events.on("step_failed", (e: { goalId: string; stepId: string }) =>
    broadcast({ type: "step_failed", goalId: e.goalId, stepId: e.stepId })
  );
  opts.orchestrator.events.on(
    "step_chunk",
    (e: { goalId: string; stepId: string; stream: "stdout" | "stderr"; chunk: string }) =>
      broadcast({ type: "step_chunk", goalId: e.goalId, stepId: e.stepId, stream: e.stream, chunk: e.chunk })
  );

  // 2) Cross-process: watch audit.jsonl and poll DB so state from a separate
  //    `klimand run` process is visible to the dashboard.
  const auditFile = opts.audit.file;
  let auditOffset = 0;
  try {
    auditOffset = (await stat(auditFile)).size;
  } catch {
    auditOffset = 0;
  }

  const pollAudit = async () => {
    try {
      const st = await stat(auditFile);
      if (st.size <= auditOffset) return;
      const buf = await readFile(auditFile, "utf8");
      const tail = buf.slice(auditOffset);
      auditOffset = buf.length;
      for (const line of tail.split(/\r?\n/)) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { action: string; goal_id?: string; step_id?: string };
          const goalId = event.goal_id;
          const stepId = event.step_id;
          if (!goalId) continue;
          if (event.action === "goal_created") broadcast({ type: "goal_created", goalId });
          else if (event.action === "step_started") broadcast({ type: "step_started", goalId, stepId });
          else if (event.action === "step_finished") broadcast({ type: "step_finished", goalId, stepId });
          else if (event.action === "step_failed") broadcast({ type: "step_failed", goalId, stepId });
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* audit file may not exist yet */
    }
  };

  const pollGoalStatuses = () => {
    for (const goal of opts.store.listGoals()) {
      const prev = goalSnapshot.get(goal.id);
      if (!prev || prev.status !== goal.status || prev.cycle !== goal.cycle) {
        goalSnapshot.set(goal.id, { status: goal.status, cycle: goal.cycle });
        broadcast({ type: "goal_status", goalId: goal.id, status: goal.status, cycle: goal.cycle });
      }
    }
  };

  const pollHandle = setInterval(async () => {
    await pollAudit();
    pollGoalStatuses();
  }, 750);

  let auditWatcher: ReturnType<typeof watch> | null = null;
  try {
    auditWatcher = watch(path.dirname(auditFile), { persistent: false }, (_e, name) => {
      if (name && path.basename(auditFile) === name.toString()) {
        pollAudit().catch(() => {});
      }
    });
  } catch {
    auditWatcher = null;
  }

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, opts, sseClients, broadcast);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: msg });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));

  return {
    async close() {
      clearInterval(pollHandle);
      if (auditWatcher) auditWatcher.close();
      for (const client of sseClients) {
        try {
          client.res.end();
        } catch {
          /* ignore */
        }
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ServeOptions,
  sseClients: Set<SseClient>,
  broadcast: (event: Record<string, unknown>) => void
): Promise<void> {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/events" && req.method === "GET") {
    handleEvents(req, res, sseClients);
    return;
  }

  if (pathname === "/api/goals" && req.method === "GET") {
    sendJson(res, 200, listGoalThreads(opts.store));
    return;
  }

  const goalMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
  if (goalMatch && req.method === "GET") {
    const goal = getGoalThread(opts.store, decodeURIComponent(goalMatch[1]!));
    if (!goal) {
      sendJson(res, 404, { error: "goal not found" });
      return;
    }
    sendJson(res, 200, goal);
    return;
  }

  const statusMatch = pathname.match(/^\/api\/goals\/([^/]+)\/status$/);
  if (statusMatch && req.method === "POST") {
    const goalId = decodeURIComponent(statusMatch[1]!);
    const body = await readBody(req);
    let parsed: { status?: string };
    try {
      parsed = JSON.parse(body) as { status?: string };
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    if (parsed.status !== "active" && parsed.status !== "stopped") {
      sendJson(res, 400, { error: "status must be active or stopped" });
      return;
    }
    opts.store.updateGoalStatus(goalId, parsed.status);
    const goal = opts.store.getGoal(goalId);
    if (goal) broadcast({ type: "goal_status", goalId, status: goal.status, cycle: goal.cycle });
    res.writeHead(204);
    res.end();
    return;
  }

  const logMatch = pathname.match(/^\/api\/logs\/([^/]+)\/([^/]+)$/);
  if (logMatch && req.method === "GET") {
    const goalId = decodeURIComponent(logMatch[1]!);
    const stepId = decodeURIComponent(logMatch[2]!);
    const steps = opts.store.getSteps(goalId);
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      sendJson(res, 404, { error: "step not found" });
      return;
    }
    const file = path.join(step.artifactsDir, "stdout.log");
    try {
      const text = await readFile(file, "utf8");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(text);
    } catch {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("");
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (buf += chunk));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

function handleEvents(req: IncomingMessage, res: ServerResponse, sseClients: Set<SseClient>): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write("\n");
  const client: SseClient = { res, alive: true };
  sseClients.add(client);
  const heartbeat = setInterval(() => {
    if (!client.alive) return;
    try {
      res.write(": ping\n\n");
    } catch {
      client.alive = false;
    }
  }, 15000);
  req.on("close", () => {
    client.alive = false;
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
}
