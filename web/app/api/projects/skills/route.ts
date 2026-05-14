import { NextResponse } from "next/server";
import { getRegistry, invalidateRegistry } from "@/lib/klimand-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("path");
  const refresh = url.searchParams.get("refresh") === "1";
  if (refresh) invalidateRegistry(projectPath);
  try {
    const registry = await getRegistry({ projectPath: projectPath ?? null });
    return NextResponse.json({
      skills: registry.skills.map((s) => ({
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        appliesWhen: s.appliesWhen,
        version: s.version,
        source: s.source.kind,
        path: s.source.path
      })),
      errors: registry.errors,
      loadedAt: registry.loadedAt,
      projectPath: registry.projectPath
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "load_failed", message: msg }, { status: 500 });
  }
}
