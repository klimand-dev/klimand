import { run, user } from "@openai/agents";
import { makeAgent } from "./agent";
import { getPrefs } from "./prefs";
import { getDoctor } from "./doctor";
import { appendRun, getSchedule, newRunId, updateRun, type Schedule } from "./schedules";
import { touchThread, getThread } from "./threads";
import { getProfile } from "./project-profile";

interface RunResult {
  status: "ok" | "error" | "cancelled";
  summary: string;
  durationMs: number;
}

interface AgentRunResultLike {
  finalOutput?: unknown;
}

function extractFinalText(result: AgentRunResultLike): string {
  if (typeof result.finalOutput === "string") return result.finalOutput;
  try {
    return JSON.stringify(result.finalOutput);
  } catch {
    return "";
  }
}

export async function runScheduledOnce(scheduleId: string): Promise<RunResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const runId = newRunId();
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    return { status: "error", summary: "schedule not found", durationMs: 0 };
  }

  await appendRun(scheduleId, {
    id: runId,
    startedAt,
    status: "running"
  });

  try {
    const [prefs, doctor] = await Promise.all([getPrefs(), getDoctor()]);
    if (!process.env.OPENAI_API_KEY && prefs.llm.openai.apiKey) {
      process.env.OPENAI_API_KEY = prefs.llm.openai.apiKey;
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set (paste one in Settings → BYOK or set the env var)");
    }
    let projectPath: string | undefined;
    let projectDigest: string | undefined;
    const thread = await getThread(schedule.threadId).catch(() => null);
    if (thread?.projectPath) {
      projectPath = thread.projectPath;
      try {
        const { digest } = await getProfile(thread.projectPath);
        projectDigest = digest;
      } catch {
        /* fall back to no-digest */
      }
    }
    const agent = makeAgent({ prefs, doctor, projectDigest });
    const input = [user(schedule.prompt)];
    const result = (await run(agent, input, {
      context: { prefs, threadId: schedule.threadId, projectPath }
    })) as AgentRunResultLike;

    const durationMs = Date.now() - started;
    const summary = extractFinalText(result).slice(0, 4000);
    await updateRun(scheduleId, runId, {
      status: "ok",
      summary,
      durationMs,
      finishedAt: new Date().toISOString()
    });
    await touchThread(schedule.threadId).catch(() => {});
    return { status: "ok", summary, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    await updateRun(scheduleId, runId, {
      status: "error",
      summary: message,
      durationMs,
      finishedAt: new Date().toISOString()
    });
    return { status: "error", summary: message, durationMs };
  }
}

export function describeSchedule(s: Schedule): string {
  return `${s.name} (${s.cron})${s.enabled ? "" : " — disabled"}`;
}
