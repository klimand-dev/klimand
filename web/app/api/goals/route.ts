import { NextResponse } from "next/server";
import { z } from "zod";
import { createGoal, listGoals } from "@/lib/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateGoalBodySchema = z.object({
  threadId: z.string().min(1),
  projectPath: z.string().nullable(),
  outcome: z.string().min(1),
  // Stop condition is auto-derived from the outcome when the caller (e.g. the
  // suggest-banner) doesn't have a specific signal in mind. The decomposition
  // skill is responsible for refining it during planning.
  stopCondition: z.string().min(1).optional(),
  decomposedBy: z.string().default("manual"),
  subTasks: z
    .array(
      z.object({
        description: z.string(),
        prompt: z.string(),
        provider: z.enum(["claude", "codex", "claude-or-codex"]),
        verification: z.string(),
        dependsOn: z.array(z.number().int().nonnegative()).optional()
      })
    )
    .default([])
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const status = url.searchParams.get("status");
  const filter: { threadId?: string; status?: NonNullable<ReturnType<typeof toStatus>> } = {};
  if (threadId) filter.threadId = threadId;
  const s = toStatus(status);
  if (s !== null) filter.status = s;
  const goals = await listGoals(filter);
  return NextResponse.json({ goals });
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = CreateGoalBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const stopCondition =
    parsed.data.stopCondition && parsed.data.stopCondition.trim().length > 0
      ? parsed.data.stopCondition
      : `All planned sub-tasks pass for: ${parsed.data.outcome}`;
  const goal = await createGoal({
    threadId: parsed.data.threadId,
    projectPath: parsed.data.projectPath,
    outcome: parsed.data.outcome,
    stopCondition,
    decomposedBy: parsed.data.decomposedBy,
    subTasks: parsed.data.subTasks.map((st) => ({
      description: st.description,
      prompt: st.prompt,
      provider: st.provider,
      verification: st.verification,
      dependsOn: st.dependsOn ?? []
    }))
  });
  return NextResponse.json({ goal }, { status: 201 });
}

function toStatus(s: string | null): "planning" | "running" | "paused" | "succeeded" | "failed" | "escalated" | null {
  if (!s) return null;
  const allowed = ["planning", "running", "paused", "succeeded", "failed", "escalated"] as const;
  return (allowed as readonly string[]).includes(s) ? (s as (typeof allowed)[number]) : null;
}
