"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CircleIcon, AlertTriangleIcon, PauseIcon, PlayIcon, XIcon, LoaderIcon } from "lucide-react";
import type { Goal, SubTask, GoalStatus, SubTaskStatus } from "@/lib/goals";
import { cn } from "@/lib/utils";

export interface GoalTrackerProps {
  goalId: string;
  onClose?: () => void;
}

interface GoalResponse {
  goal?: Goal;
  error?: string;
}

const POLL_MS = 2000;

export function GoalTracker({ goalId, onClose }: GoalTrackerProps): React.ReactElement {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals/${goalId}`, { cache: "no-store" });
      const json = (await res.json()) as GoalResponse;
      if (!res.ok || !json.goal) {
        setError(json.error ?? `error ${res.status}`);
        return;
      }
      setGoal(json.goal);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (goal && (goal.status === "succeeded" || goal.status === "failed" || goal.status === "escalated")) return;
      load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [goal, load]);

  const patch = useCallback(async (body: Record<string, string>) => {
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    load();
  }, [goalId, load]);

  if (loading) {
    return <div className="font-mono text-xs italic text-muted-foreground">loading goal…</div>;
  }
  if (error || !goal) {
    return (
      <div className="rounded border border-red-700/50 bg-red-900/10 px-3 py-2 font-mono text-[11px] text-red-300">
        {error ?? "no goal"}
      </div>
    );
  }

  const total = goal.subTasks.length;
  const done = goal.subTasks.filter((st) => st.status === "succeeded").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const canPause = goal.status === "running";
  const canResume = goal.status === "paused";
  const canCancel = goal.status === "running" || goal.status === "paused";

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-card/40 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Goal</span>
            <StatusPill status={goal.status} />
          </div>
          <div className="mt-1 font-mono text-sm font-semibold">{goal.outcome}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            Stop when: {goal.stopCondition}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canPause ? (
            <IconButton title="Pause" onClick={() => patch({ status: "paused" })}>
              <PauseIcon className="h-3 w-3" />
            </IconButton>
          ) : null}
          {canResume ? (
            <IconButton title="Resume" onClick={() => patch({ status: "running" })}>
              <PlayIcon className="h-3 w-3" />
            </IconButton>
          ) : null}
          {canCancel ? (
            <IconButton title="Cancel" onClick={() => patch({ status: "failed" })}>
              <XIcon className="h-3 w-3" />
            </IconButton>
          ) : null}
          {onClose ? (
            <IconButton title="Close" onClick={onClose}>
              <XIcon className="h-3 w-3" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
          <span>{done}/{total} sub-tasks · {pct}%</span>
          <span>updated {new Date(goal.updatedAt).toLocaleTimeString()}</span>
        </div>
        <div className="h-1.5 w-full rounded bg-muted">
          <div className="h-full rounded bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {goal.subTasks.map((st) => (
          <SubTaskRow key={st.id} subTask={st} />
        ))}
      </ul>
    </div>
  );
}

function SubTaskRow({ subTask }: { subTask: SubTask }): React.ReactElement {
  return (
    <li className="flex items-start gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <SubTaskIcon status={subTask.status} />
      <div className="flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold text-foreground">{subTask.index + 1}. {subTask.description}</span>
          <span className="font-mono text-[10px] text-muted-foreground">[{subTask.provider}]</span>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">verify: {subTask.verification}</div>
        {subTask.evaluation?.note ? (
          <div className="mt-0.5 font-mono text-[10px] text-amber-300">{subTask.evaluation.note}</div>
        ) : null}
      </div>
      {subTask.attempts > 1 ? (
        <span className="font-mono text-[10px] text-muted-foreground">×{subTask.attempts}</span>
      ) : null}
    </li>
  );
}

function SubTaskIcon({ status }: { status: SubTaskStatus }): React.ReactElement {
  if (status === "succeeded") return <CheckIcon className="mt-0.5 h-3 w-3 text-emerald-400" />;
  if (status === "running") return <LoaderIcon className="mt-0.5 h-3 w-3 animate-spin text-accent" />;
  if (status === "failed") return <AlertTriangleIcon className="mt-0.5 h-3 w-3 text-red-400" />;
  if (status === "skipped") return <XIcon className="mt-0.5 h-3 w-3 text-muted-foreground" />;
  return <CircleIcon className="mt-0.5 h-3 w-3 text-muted-foreground" />;
}

function StatusPill({ status }: { status: GoalStatus }): React.ReactElement {
  const colorClass =
    status === "succeeded" ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-300"
      : status === "running" ? "border-accent/50 bg-accent/10 text-accent"
        : status === "failed" || status === "escalated" ? "border-red-700/50 bg-red-900/20 text-red-300"
          : status === "paused" ? "border-amber-700/50 bg-amber-900/20 text-amber-300"
            : "border-border bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide", colorClass)}>
      {status}
    </span>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}
