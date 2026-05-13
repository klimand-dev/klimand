import { NextResponse } from "next/server";
import { listThreads, createThread, ThreadKindSchema } from "@/lib/threads";
import { ensureScheduler } from "@/lib/scheduler-init";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // Boot the scheduler lazily on the first thread-list request. This is the
  // earliest signal that the UI is alive and any pending schedules should be
  // running again after a restart.
  ensureScheduler().catch(() => {});
  const threads = await listThreads();
  return NextResponse.json({ threads });
}

export async function POST(req: Request): Promise<Response> {
  let body: { title?: string; kind?: string; scheduleId?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body is fine — create a default chat thread */
  }
  const parsedKind = body.kind ? ThreadKindSchema.safeParse(body.kind) : undefined;
  const kind = parsedKind && parsedKind.success ? parsedKind.data : "chat";
  const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim() : undefined;
  const scheduleId = typeof body.scheduleId === "string" ? body.scheduleId : undefined;
  const thread = await createThread({ title, kind, scheduleId });
  return NextResponse.json({ thread }, { status: 201 });
}
