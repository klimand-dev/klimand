import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteGoal, getGoal, updateGoal } from "@/lib/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateGoalBodySchema = z.object({
  status: z.enum(["planning", "running", "paused", "succeeded", "failed", "escalated"]).optional(),
  outcome: z.string().optional(),
  stopCondition: z.string().optional()
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const goal = await getGoal(id);
  if (!goal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ goal });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = UpdateGoalBodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const goal = await updateGoal(id, parsed.data);
  if (!goal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ goal });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ok = await deleteGoal(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
