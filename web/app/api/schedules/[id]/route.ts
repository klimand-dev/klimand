import { NextResponse } from "next/server";
import { z } from "zod";
import { getSchedule, updateSchedule, deleteSchedule } from "@/lib/schedules";
import { isCronValid, reloadScheduler } from "@/lib/scheduler-init";
import { runScheduledOnce } from "@/lib/run-scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  cron: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const schedule = await getSchedule(id);
  if (!schedule) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ schedule });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (parsed.data.cron && !isCronValid(parsed.data.cron)) {
    return NextResponse.json({ error: "invalid cron expression" }, { status: 400 });
  }
  const updated = await updateSchedule(id, parsed.data);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  await reloadScheduler();
  return NextResponse.json({ schedule: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ok = await deleteSchedule(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  await reloadScheduler();
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body fine */
  }
  if (body.action !== "run-now") {
    return NextResponse.json({ error: "expected { action: 'run-now' }" }, { status: 400 });
  }
  const result = await runScheduledOnce(id);
  return NextResponse.json({ result });
}
