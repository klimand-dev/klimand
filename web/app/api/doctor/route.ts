import { NextResponse } from "next/server";
import { getDoctor, refreshDoctor } from "@/lib/doctor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await getDoctor();
  return NextResponse.json(report);
}

export async function POST(req: Request): Promise<Response> {
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    /* empty body is fine */
  }
  if (body.action !== "refresh") {
    return NextResponse.json({ error: "expected { action: 'refresh' }" }, { status: 400 });
  }
  const report = await refreshDoctor();
  return NextResponse.json(report);
}
