import { NextResponse } from "next/server";
import { getThread, updateThread, deleteThread } from "@/lib/threads";
import { listSchedules, deleteSchedule } from "@/lib/schedules";
import { reloadScheduler } from "@/lib/scheduler-init";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let body: { title?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const updated = await updateThread(id, { title });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  // Cascade: if a schedule references this thread, delete it too so the cron
  // runner doesn't keep ticking against a missing thread.
  const schedules = await listSchedules();
  const orphans = schedules.filter((s) => s.threadId === id);
  let scheduleChanges = 0;
  for (const s of orphans) {
    await deleteSchedule(s.id);
    scheduleChanges++;
  }
  const ok = await deleteThread(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scheduleChanges > 0) await reloadScheduler();
  return NextResponse.json({ ok: true, schedulesRemoved: scheduleChanges });
}
