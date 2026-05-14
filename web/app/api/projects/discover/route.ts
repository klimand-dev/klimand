import { NextResponse } from "next/server";
import { discoverProjectsCached } from "@/lib/discover-projects";
import { getRegistry, setLastScan } from "@/lib/project-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const result = await discoverProjectsCached(refresh);
    const registry = await getRegistry();
    const approved = new Set(registry.approved.map((e) => e.path));
    const hidden = new Set(registry.hidden);
    const filtered = result.candidates.filter((c) => !approved.has(c.path) && !hidden.has(c.path));
    if (refresh) {
      void setLastScan(result.roots, result.candidates.length).catch(() => undefined);
    }
    return NextResponse.json({
      candidates: filtered,
      totalFound: result.candidates.length,
      scannedAt: result.scannedAt,
      roots: result.roots,
      durationMs: result.durationMs,
      truncated: result.truncated
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "discover_failed", message: msg }, { status: 500 });
  }
}
