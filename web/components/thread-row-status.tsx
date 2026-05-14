"use client";

import { useEffect, useState } from "react";
import { AlertCircleIcon } from "lucide-react";
import { formatDuration } from "@/components/tool-ui/terminal/terminal";
import type { ThreadStatus } from "@/lib/use-thread-statuses";
import { cn } from "@/lib/utils";

interface Props {
  status: ThreadStatus | undefined;
}

// Per-row indicator cluster. Three mutually-exclusive states by priority:
//   1. Awaiting approval (amber badge with count)
//   2. Running (pulsing green dot + live elapsed pill)
//   3. Settled (subtle "ran N" pill if we have a last duration)
// When none apply, render nothing — relative-time on the row stands alone.
export function ThreadRowStatus({ status }: Props): React.ReactElement | null {
  const hasApproval = status != null && status.pendingApprovalCount > 0;
  const isRunning = status?.isRunning ?? false;
  const startedAt = status?.currentTurnStartedAt ?? null;
  const lastDuration = status?.lastTurnDurationMs ?? null;

  // Live tick. Re-anchored on each status snapshot via startedAt dependency.
  const [tickMs, setTickMs] = useState<number | null>(null);
  useEffect(() => {
    if (!isRunning || startedAt == null) {
      setTickMs(null);
      return;
    }
    const update = () => setTickMs(Date.now() - startedAt);
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  if (hasApproval) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
        title={`${status!.pendingApprovalCount} awaiting approval`}
      >
        <AlertCircleIcon className="h-3 w-3" />
        {status!.pendingApprovalCount}
      </span>
    );
  }

  if (isRunning) {
    const label = formatDuration(tickMs ?? 0) ?? "0s";
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400"
        title="Currently running"
      >
        <RunningDot />
        {label}
      </span>
    );
  }

  if (lastDuration != null) {
    const label = formatDuration(lastDuration);
    if (label) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80"
          title="Last turn duration"
        >
          {label}
        </span>
      );
    }
  }

  return null;
}

function RunningDot(): React.ReactElement {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className={cn(
          "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"
        )}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}
