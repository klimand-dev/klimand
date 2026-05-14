"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon, PlayIcon, CloudIcon } from "lucide-react";
import type { Schedule, ScheduleRun } from "@/lib/schedules";
import { useLicense } from "@/lib/use-license";
import { cn } from "@/lib/utils";

export interface ScheduledRunsViewProps {
  threadId: string;
}

export function ScheduledRunsView({ threadId }: ScheduledRunsViewProps): React.ReactElement {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { isPro } = useLicense();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { schedules: Schedule[] };
      const match = data.schedules.find((s) => s.threadId === threadId) ?? null;
      setSchedule(match);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = useCallback(async () => {
    if (!schedule || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run-now" })
      });
      await load();
    } finally {
      setBusy(false);
    }
  }, [schedule, busy, load]);

  const toggleHosted = useCallback(async () => {
    if (!schedule || busy || !isPro) return;
    setBusy(true);
    try {
      await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hosted: !schedule.hosted })
      });
      await load();
    } finally {
      setBusy(false);
    }
  }, [schedule, busy, isPro, load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
        loading scheduled thread…
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="font-mono text-sm text-muted-foreground">
          This is a scheduled thread, but no schedule references it.
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          You can safely delete it from the thread list.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-1 flex-col gap-1">
          <div className="font-mono text-sm font-semibold">{schedule.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            cron: <code>{schedule.cron}</code> · {schedule.enabled ? "enabled" : "disabled"}
            {schedule.lastRunAt ? ` · last run ${new Date(schedule.lastRunAt).toLocaleString()}` : ""}
          </div>
          <details className="font-mono text-xs text-muted-foreground">
            <summary className="cursor-pointer">prompt</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background p-2 text-foreground">
              {schedule.prompt}
            </pre>
          </details>
        </div>
        <button
          type="button"
          onClick={toggleHosted}
          disabled={busy || !isPro}
          title={isPro ? (schedule.hosted ? "Run on Klimand's cloud (Pro)" : "Run locally") : "Pro required to enable hosted scheduling"}
          className={cn(
            "flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-xs disabled:opacity-50",
            schedule.hosted
              ? "border-emerald-700/60 bg-emerald-900/20 text-emerald-300"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          <CloudIcon className="h-3 w-3" />
          {schedule.hosted ? "hosted" : "local"}
        </button>
        <button
          type="button"
          onClick={runNow}
          disabled={busy}
          className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <PlayIcon className="h-3 w-3" />
          {busy ? "running…" : "run now"}
        </button>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          aria-label="Refresh runs"
        >
          <RefreshCwIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {schedule.runs.length === 0 ? (
          <div className="font-mono text-xs italic text-muted-foreground">
            No runs yet. The first tick will appear when cron fires, or click &quot;run now&quot;.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {schedule.runs.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunCard({ run }: { run: ScheduleRun }): React.ReactElement {
  const tone =
    run.status === "ok"
      ? "border-emerald-700/50 text-emerald-300"
      : run.status === "error"
        ? "border-red-700/50 text-red-300"
        : "border-border text-muted-foreground";
  const duration = run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "";
  return (
    <div className={cn("rounded border bg-background/40 p-3", tone)}>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="uppercase tracking-wide">{run.status}</span>
        <span className="flex-1" />
        <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        {duration ? <span className="text-muted-foreground">· {duration}</span> : null}
      </div>
      {run.summary ? (
        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-xs text-foreground">
          {run.summary}
        </pre>
      ) : null}
    </div>
  );
}
