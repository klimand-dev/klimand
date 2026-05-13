import { NextResponse } from "next/server";
import { getCurrentSandbox, getSandboxForThread, rotateSandbox } from "@/lib/sandbox";
import { getThread } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  if (threadId) {
    const thread = await getThread(threadId);
    if (!thread) return NextResponse.json({ error: "thread not found" }, { status: 404 });
    const path = await getSandboxForThread(threadId);
    return NextResponse.json({ path, threadId });
  }
  const path = await getCurrentSandbox();
  return NextResponse.json({ path });
}

export async function POST(req: Request): Promise<Response> {
  let body: { action?: string; threadId?: string } = {};
  try {
    body = (await req.json()) as { action?: string; threadId?: string };
  } catch {
    /* empty body is fine */
  }
  if (body.action !== "rotate") {
    return NextResponse.json({ error: "expected { action: 'rotate' }" }, { status: 400 });
  }
  const path = await rotateSandbox(body.threadId);
  return NextResponse.json({ path, threadId: body.threadId ?? null });
}
