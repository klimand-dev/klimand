// Cron tick. Every minute the Worker scans the KV index of hosted schedules
// and fires any whose `nextRun` is past. Firing = sending a Web Push to the
// owning license's subscribed devices, plus a webhook entry the local app
// pulls on next sync.
//
// The local app is responsible for the actual CLI run; the Worker only
// signals "time to run schedule X."
//
// Schedule shape (stored under `sched:<licenseKey>:<scheduleId>`):
//   { id, licenseKey, cron, nextRun, threadId, payload }

import { sendPushToLicense } from "./push";
import type { Env } from "./index";

interface HostedSchedule {
  id: string;
  licenseKey: string;
  cron: string;
  nextRun: number; // unix ms
  threadId?: string;
  label?: string;
  payload?: unknown;
}

export async function tickSchedules(env: Env, scheduledTime: number): Promise<void> {
  const list = await env.KLIMAND_KV.list({ prefix: "sched:" });
  for (const k of list.keys) {
    const s = await env.KLIMAND_KV.get<HostedSchedule>(k.name, "json");
    if (!s) continue;
    if (s.nextRun > scheduledTime) continue;
    // Fire.
    await sendPushToLicense(env, s.licenseKey, {
      title: "Klimand: scheduled run",
      body: s.label ?? `Schedule ${s.id} is firing`,
      tag: `sched-${s.id}`,
      url: s.threadId ? `/threads/${s.threadId}` : "/"
    });
    // Compute next fire from cron. Workers don't ship a cron lib; we do a
    // simple "+1 hour" fallback if parsing fails. The local app reconciles.
    s.nextRun = nextFireMs(s.cron, scheduledTime) ?? scheduledTime + 60 * 60 * 1000;
    await env.KLIMAND_KV.put(k.name, JSON.stringify(s));
  }
}

// Minimal cron-next computation. Supports `* * * * *` only; anything else we
// punt to "next hour" so the run still happens, just less precisely. The
// local app remains the canonical source of cron semantics; the Worker is a
// nudge.
function nextFireMs(cron: string, from: number): number | null {
  if (cron === "* * * * *") return from + 60 * 1000;
  return null;
}
