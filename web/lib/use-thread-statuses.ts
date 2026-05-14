"use client";

import { useEffect, useRef, useState } from "react";

export interface ThreadStatus {
  isRunning: boolean;
  pendingApprovalCount: number;
  currentTurnStartedAt: number | null;
  lastTurnDurationMs: number | null;
  lastTurnEndedAt: number | null;
}

const POLL_MS = 2000;

// Polls /api/threads/status on a 2s cadence in the foreground; pauses when
// the tab is hidden (next visibilitychange triggers an immediate refetch).
// Returns a plain object keyed by threadId — callers can read by id and
// fall back to an idle shape when missing.
export function useThreadStatuses(): Record<string, ThreadStatus> {
  const [statuses, setStatuses] = useState<Record<string, ThreadStatus>>({});
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const fetchOnce = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await fetch("/api/threads/status", { cache: "no-store" });
        if (cancelledRef.current) return;
        if (res.ok) {
          const data = (await res.json()) as { statuses: Record<string, ThreadStatus> };
          if (!cancelledRef.current) setStatuses(data.statuses ?? {});
        }
      } catch {
        /* swallow transient errors — next tick retries */
      }
    };

    const scheduleNext = () => {
      if (cancelledRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      timerRef.current = setTimeout(async () => {
        await fetchOnce();
        scheduleNext();
      }, POLL_MS);
    };

    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (timerRef.current) clearTimeout(timerRef.current);
        void fetchOnce().then(scheduleNext);
      }
    };

    void fetchOnce().then(scheduleNext);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return statuses;
}
