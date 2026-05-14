import { NextResponse } from "next/server";
import { getLicenseState, setLicenseKey, verifyLicense } from "@/lib/license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const state = await getLicenseState();
  return NextResponse.json(state);
}

export async function POST(req: Request): Promise<Response> {
  let body: { key?: string | null; action?: "set" | "verify" | "clear" } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.action === "verify") {
    const state = await verifyLicense(true);
    return NextResponse.json(state);
  }
  if (body.action === "clear") {
    const state = await setLicenseKey(null);
    return NextResponse.json(state);
  }
  // default = set
  const next = body.key && typeof body.key === "string" && body.key.trim() ? body.key.trim() : null;
  const state = await setLicenseKey(next);
  return NextResponse.json(state);
}
