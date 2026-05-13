import { NextResponse } from "next/server";
import { resolveApproval } from "@/lib/tool-output-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ callId: string }> }
): Promise<Response> {
  const { callId } = await ctx.params;
  let body: { decision?: string; editedPrompt?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }
  const editedPrompt =
    body.decision === "approve" && typeof body.editedPrompt === "string" && body.editedPrompt.trim().length > 0
      ? body.editedPrompt
      : undefined;
  const resolved = resolveApproval(callId, { decision: body.decision, editedPrompt });
  return NextResponse.json({ ok: true, resolved });
}
