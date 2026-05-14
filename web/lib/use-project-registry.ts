"use client";

import { useCallback, useEffect, useState } from "react";

export interface ProjectEntry {
  path: string;
  label: string;
  addedAt: string;
  lastUsed: string;
}

export interface ProjectRegistry {
  approved: ProjectEntry[];
  hidden: string[];
}

interface RegistryResponse {
  registry: ProjectRegistry;
}

interface MutateResponse extends RegistryResponse {
  entry?: ProjectEntry;
  error?: string;
  message?: string;
}

export interface UseProjectRegistry {
  registry: ProjectRegistry;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  approve: (path: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (path: string) => Promise<void>;
  hide: (path: string) => Promise<void>;
  unhide: (path: string) => Promise<void>;
}

const EMPTY: ProjectRegistry = { approved: [], hidden: [] };

export function useProjectRegistry(): UseProjectRegistry {
  const [registry, setRegistry] = useState<ProjectRegistry>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects/registry", { cache: "no-store" });
      if (!res.ok) {
        setError(`registry ${res.status}`);
        return;
      }
      const data = (await res.json()) as RegistryResponse;
      setRegistry(data.registry ?? EMPTY);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (action: "approve" | "remove" | "hide" | "unhide", p: string) => {
      const res = await fetch("/api/projects/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p, action })
      });
      const data = (await res.json().catch(() => ({}))) as MutateResponse;
      if (res.ok && data.registry) {
        setRegistry(data.registry);
        return { ok: true } as const;
      }
      return { ok: false, error: data.message || data.error || `error ${res.status}` } as const;
    },
    []
  );

  const approve = useCallback(async (p: string) => mutate("approve", p), [mutate]);
  const remove = useCallback(async (p: string) => {
    await mutate("remove", p);
  }, [mutate]);
  const hide = useCallback(async (p: string) => {
    await mutate("hide", p);
  }, [mutate]);
  const unhide = useCallback(async (p: string) => {
    await mutate("unhide", p);
  }, [mutate]);

  return { registry, loading, error, refresh, approve, remove, hide, unhide };
}
