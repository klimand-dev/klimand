import { NextResponse } from "next/server";
import { cancelGoal, isRunning } from "@/lib/goal-runner";
import { getGoal, updateGoal } from "@/lib/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const goal = await getGoal(id);
  if (!goal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const wasRunning = isRunning(id);
  const cancelled = cancelGoal(id);
  // If the runner wasn't active, still patch the persisted state so the UI
  // reflects user intent immediately.
  if (!cancelled && (goal.status === "planning" || goal.status === "running" || goal.status === "paused")) {
    await updateGoal(id, { status: "failed" });
  }
  return NextResponse.json({ cancelled, wasRunning });
}
