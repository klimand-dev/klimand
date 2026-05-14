"use client";

import { useCallback, useEffect, useState } from "react";
import type { Thread, ThreadKind } from "./threads";

export interface UseThreads {
  threads: Thread[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input?: { title?: string; kind?: ThreadKind; scheduleId?: string; ingestUrl?: string; projectPath?: string }) => Promise<Thread | null>;
  createIngest: (ingestUrl: string) => Promise<{ thread: Thread | null; error?: string }>;
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

  const createIngest: UseThreads["createIngest"] = useCallback(
    async (ingestUrl) => {
      try {
        const res = await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ingestUrl })
        });
        const data = (await res.json().catch(() => ({}))) as {
          thread?: Thread;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          return { thread: null, error: data.message || data.error || `error ${res.status}` };
        }
        await refresh();
        return { thread: data.thread ?? null };
      } catch (e) {
        return { thread: null, error: e instanceof Error ? e.message : String(e) };
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
        localStorage.removeItem(`klimand:thread:${id}:messages`);
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

  return { threads, loading, refresh, create, createIngest, remove, rename };
}
