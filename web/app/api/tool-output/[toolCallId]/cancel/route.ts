import { NextRequest, NextResponse } from "next/server";
import { abort } from "@/lib/tool-output-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ toolCallId: string }> }
): Promise<Response> {
  const { toolCallId } = await ctx.params;
  const cancelled = abort(toolCallId);
  return NextResponse.json({ ok: true, cancelled });
}
