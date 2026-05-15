"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Goal } from "@/lib/goals";

interface GoalsResponse {
  goals?: Goal[];
}

const POLL_MS = 3000;
const ACTIVE_STATES: Goal["status"][] = ["planning", "running", "paused"];

/**
 * Poll /api/goals?threadId=… and return the most recent active goal (if any)
 * for this thread. "Active" = status is planning, running, or paused. Pauses
 * polling when the document is hidden. Use `refresh` to force an immediate
 * fetch (e.g. just after starting a new goal from the banner).
 */
export function useThreadGoal(threadId: string | null): {
  goal: Goal | null;
  loading: boolean;
  refresh: () => void;
} {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const cancelledRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(`/api/goals?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as GoalsResponse;
      if (cancelledRef.current) return;
      const active = (json.goals ?? []).find((g) => ACTIVE_STATES.includes(g.status));
      // updateGoal already sorts list by updatedAt desc; first active wins.
      setGoal(active ?? null);
    } catch {
      /* network blip — try again next tick */
    }
  }, [threadId]);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchOnce().finally(() => {
      if (!cancelledRef.current) setLoading(false);
    });
  }, [fetchOnce]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!threadId) {
      setGoal(null);
      return;
    }
    refresh();
    const start = () => {
      if (tickRef.current) return;
      tickRef.current = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          void fetchOnce();
        }
      }, POLL_MS);
    };
    const stop = () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
    start();
    const onVisibility = (): void => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        void fetchOnce();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelledRef.current = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [threadId, fetchOnce, refresh]);

  return { goal, loading, refresh };
}
