"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { TargetIcon, XIcon, LoaderIcon } from "lucide-react";
import { detectGoalShape } from "@/lib/goal-shape-detector";

interface AnyMessagePart {
  type: string;
  text?: string;
}

interface ThreadMessageLike {
  role: string;
  parts?: AnyMessagePart[];
}

interface ThreadFetchResponse {
  thread?: { projectPath?: string | null };
}

interface CreateGoalResponse {
  goal?: { id: string };
  error?: string;
}

interface GoalSuggestBannerProps {
  threadId: string;
  // Notified when a goal has been kicked off so the parent can hide the banner
  // and surface the tracker.
  onGoalStarted?: (goalId: string) => void;
}

/**
 * Banner that surfaces above the chat when the first user turn looks
 * goal-shaped. Clicking "Run as goal" creates a Goal record with the message as
 * the outcome and starts the autonomy-loop runner against it.
 */
export function GoalSuggestBanner({ threadId, onGoalStarted }: GoalSuggestBannerProps): React.ReactElement | null {
  const messages = useAuiState((s) => (s.thread.messages as unknown) as ThreadMessageLike[]);
  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(`klimand:goal-banner-dismissed:${threadId}`) === "1");
  }, [threadId]);

  if (dismissed) return null;

  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;
  const text = (firstUser.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ")
    .trim();
  const signal = detectGoalShape(text);
  if (!signal.isGoalShaped) return null;
  if (signal.confidence === "low") return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`klimand:goal-banner-dismissed:${threadId}`, "1");
    }
  };

  const runAsGoal = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Best-effort: thread metadata gives us the project path when one is bound.
      let projectPath: string | null = null;
      try {
        const tr = await fetch(`/api/threads/${threadId}`, { cache: "no-store" });
        if (tr.ok) {
          const tj = (await tr.json()) as ThreadFetchResponse;
          projectPath = tj.thread?.projectPath ?? null;
        }
      } catch {
        /* no project context — runner uses sandbox */
      }
      const createRes = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId,
          projectPath,
          outcome: text,
          decomposedBy: "goal-decomposition"
        })
      });
      const created = (await createRes.json()) as CreateGoalResponse;
      if (!createRes.ok || !created.goal) {
        setError(created.error ?? `create failed (${createRes.status})`);
        setSubmitting(false);
        return;
      }
      const runRes = await fetch(`/api/goals/${created.goal.id}/run`, { method: "POST" });
      if (!runRes.ok) {
        const rj = (await runRes.json().catch(() => ({}))) as { error?: string };
        setError(rj.error ?? `run failed (${runRes.status})`);
        setSubmitting(false);
        return;
      }
      dismiss();
      onGoalStarted?.(created.goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-(--thread-max-width) items-start gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2">
      <TargetIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
      <div className="flex-1">
        <div className="font-mono text-xs font-semibold text-foreground">
          This looks like a multi-step goal.
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          Goal mode plans the work, runs both CLIs durably across sub-tasks, and reports progress in the tracker.
        </div>
        {error ? (
          <div className="mt-1 font-mono text-[11px] text-red-400">{error}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={runAsGoal}
        disabled={submitting}
        className="inline-flex items-center gap-1 rounded border border-accent/60 bg-accent/15 px-2 py-1 font-mono text-[11px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-60"
      >
        {submitting ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <TargetIcon className="h-3 w-3" />}
        Run as goal
      </button>
      <button
        type="button"
        title="Dismiss"
        onClick={dismiss}
        className="rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
