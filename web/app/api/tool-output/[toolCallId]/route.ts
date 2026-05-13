import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/tool-output-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ toolCallId: string }> }): Promise<Response> {
  const { toolCallId } = await ctx.params;
  const snapshot = getSnapshot(toolCallId);
  if (!snapshot) {
    return NextResponse.json({ found: false }, { status: 404 });
  }
  return NextResponse.json({ found: true, ...snapshot });
}
