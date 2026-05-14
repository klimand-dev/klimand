import { NextResponse } from "next/server";
import {
  approveProject,
  getRegistry,
  hideProject,
  removeProject,
  unhideProject
} from "@/lib/project-registry";
import { ProjectPathError } from "@/lib/project-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  path?: string;
  action?: "approve" | "remove" | "hide" | "unhide";
}

export async function GET(): Promise<Response> {
  const registry = await getRegistry();
  return NextResponse.json({ registry });
}

export async function POST(req: Request): Promise<Response> {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { path: p, action } = body;
  if (!p || typeof p !== "string") {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  if (action !== "approve" && action !== "remove" && action !== "hide" && action !== "unhide") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  try {
    if (action === "approve") {
      const entry = await approveProject(p);
      const registry = await getRegistry();
      return NextResponse.json({ entry, registry });
    }
    if (action === "remove") await removeProject(p);
    else if (action === "hide") await hideProject(p);
    else await unhideProject(p);
    const registry = await getRegistry();
    return NextResponse.json({ registry });
  } catch (e) {
    if (e instanceof ProjectPathError) {
      return NextResponse.json({ error: e.kind, message: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "registry_failed", message: msg }, { status: 500 });
  }
}
