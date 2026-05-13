import { NextResponse } from "next/server";
import { z } from "zod";
import { listSchedules, createSchedule } from "@/lib/schedules";
import { createThread } from "@/lib/threads";
import { ensureScheduler, isCronValid, reloadScheduler } from "@/lib/scheduler-init";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().optional()
});

export async function GET(): Promise<Response> {
  await ensureScheduler();
  const schedules = await listSchedules();
  return NextResponse.json({ schedules });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", details: parsed.error.format() }, { status: 400 });
  }
  if (!isCronValid(parsed.data.cron)) {
    return NextResponse.json({ error: "invalid cron expression" }, { status: 400 });
  }
  // Auto-create the dedicated scheduled thread for this schedule.
  const thread = await createThread({ kind: "scheduled", title: parsed.data.name });
  const schedule = await createSchedule({
    name: parsed.data.name,
    cron: parsed.data.cron,
    prompt: parsed.data.prompt,
    threadId: thread.id,
    enabled: parsed.data.enabled ?? true
  });
  await reloadScheduler();
  return NextResponse.json({ schedule, thread }, { status: 201 });
}
