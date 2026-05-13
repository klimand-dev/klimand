"use client";

import { useCallback, useEffect, useState } from "react";
import type { Thread, ThreadKind } from "./threads";

export interface UseThreads {
  threads: Thread[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input?: { title?: string; kind?: ThreadKind; scheduleId?: string }) => Promise<Thread | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}

export function useThreads(): UseThreads {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/threads", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { threads: Thread[] };
      setThreads(data.threads);
    } catch {
      /* swallow — keep last good list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create: UseThreads["create"] = useCallback(
    async (input) => {
      try {
        const res = await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input ?? {})
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { thread: Thread };
        await refresh();
        return data.thread;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  const remove: UseThreads["remove"] = useCallback(
    async (id) => {
      try {
        await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        /* swallow */
      }
      try {
        localStorage.removeItem(`agentchain:thread:${id}:messages`);
      } catch {
        /* swallow */
      }
      await refresh();
    },
    [refresh]
  );

  const rename: UseThreads["rename"] = useCallback(
    async (id, title) => {
      try {
        await fetch(`/api/threads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title })
        });
      } catch {
        /* swallow */
      }
      await refresh();
    },
    [refresh]
  );

  return { threads, loading, refresh, create, remove, rename };
}
