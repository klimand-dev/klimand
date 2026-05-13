import { NextResponse } from "next/server";
import { setThreadProject, getThread } from "@/lib/threads";
import { validateProjectPath, ProjectPathError, invalidateProfile } from "@/lib/project-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let body: { path?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.path || typeof body.path !== "string") {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  let resolved: string;
  try {
    resolved = await validateProjectPath(body.path);
  } catch (e) {
    if (e instanceof ProjectPathError) {
      return NextResponse.json({ error: e.kind, message: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "validation_failed", message: msg }, { status: 500 });
  }
  const existing = await getThread(id);
  if (!existing) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  if (existing.projectPath && existing.projectPath !== resolved) {
    await invalidateProfile(existing.projectPath);
  }
  const updated = await setThreadProject(id, resolved);
  if (!updated) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  return NextResponse.json({ thread: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await getThread(id);
  if (!existing) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  if (existing.projectPath) await invalidateProfile(existing.projectPath);
  const updated = await setThreadProject(id, null);
  if (!updated) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  return NextResponse.json({ thread: updated });
}
