import { NextResponse } from "next/server";
import { getGoal } from "@/lib/goals";
import { startGoal, isRunning } from "@/lib/goal-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const goal = await getGoal(id);
  if (!goal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (goal.status === "succeeded" || goal.status === "failed" || goal.status === "escalated") {
    return NextResponse.json({ error: "terminal_state", status: goal.status }, { status: 409 });
  }
  const result = startGoal(id);
  return NextResponse.json({
    started: result.started,
    alreadyRunning: result.alreadyRunning,
    running: isRunning(id)
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return NextResponse.json({ running: isRunning(id) });
}
