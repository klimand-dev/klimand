"use client";

import { useCallback, useEffect, useState } from "react";
import type { Schedule } from "./schedules";

export interface UseSchedules {
  schedules: Schedule[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input: { name: string; cron: string; prompt: string; enabled?: boolean }) => Promise<Schedule | null>;
  update: (
    id: string,
    partial: Partial<Pick<Schedule, "name" | "cron" | "prompt" | "enabled">>
  ) => Promise<Schedule | null>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
}

export function useSchedules(): UseSchedules {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { schedules: Schedule[] };
      setSchedules(data.schedules);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create: UseSchedules["create"] = useCallback(
    async (input) => {
      try {
        const res = await fetch("/api/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input)
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { schedule: Schedule };
        await refresh();
        return data.schedule;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  const update: UseSchedules["update"] = useCallback(
    async (id, partial) => {
      try {
        const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(partial)
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { schedule: Schedule };
        await refresh();
        return data.schedule;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  const remove: UseSchedules["remove"] = useCallback(
    async (id) => {
      try {
        await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        /* swallow */
      }
      await refresh();
    },
    [refresh]
  );

  const runNow: UseSchedules["runNow"] = useCallback(
    async (id) => {
      try {
        await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run-now" })
        });
      } catch {
        /* swallow */
      }
      await refresh();
    },
    [refresh]
  );

  return { schedules, loading, refresh, create, update, remove, runNow };
}
