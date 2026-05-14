import { NextResponse } from "next/server";
import { getAllThreadStatuses } from "@/lib/thread-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const statuses = await getAllThreadStatuses();
  return NextResponse.json({ statuses });
}
