import { NextResponse } from "next/server";
import { getProfile, invalidateProfile, ProjectPathError } from "@/lib/project-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("path");
  if (!projectPath) return NextResponse.json({ error: "missing path" }, { status: 400 });
  const refresh = url.searchParams.get("refresh") === "1";
  const started = Date.now();
  try {
    if (refresh) await invalidateProfile(projectPath);
    const { profile, digest } = await getProfile(projectPath);
    return NextResponse.json({ profile, digest, ms: Date.now() - started, digestBytes: digest.length });
  } catch (e) {
    if (e instanceof ProjectPathError) {
      return NextResponse.json({ error: e.kind, message: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "scan_failed", message: msg }, { status: 500 });
  }
}
