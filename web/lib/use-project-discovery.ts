"use client";

import { useCallback, useState } from "react";

export interface ProjectCandidate {
  path: string;
  label: string;
  parentDir: string;
  markers: string[];
}

export interface DiscoveryState {
  candidates: ProjectCandidate[];
  scannedAt: string | null;
  durationMs: number | null;
  totalFound: number | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export interface UseProjectDiscovery extends DiscoveryState {
  discover: (refresh?: boolean) => Promise<void>;
}

const INITIAL: DiscoveryState = {
  candidates: [],
  scannedAt: null,
  durationMs: null,
  totalFound: null,
  truncated: false,
  loading: false,
  error: null
};

interface DiscoverResponse {
  candidates?: ProjectCandidate[];
  totalFound?: number;
  scannedAt?: string;
  durationMs?: number;
  truncated?: boolean;
  error?: string;
  message?: string;
}

export function useProjectDiscovery(): UseProjectDiscovery {
  const [state, setState] = useState<DiscoveryState>(INITIAL);

  const discover = useCallback(async (refresh?: boolean) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const url = refresh ? "/api/projects/discover?refresh=1" : "/api/projects/discover";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as DiscoverResponse;
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: data.message || data.error || `error ${res.status}` }));
        return;
      }
      setState({
        candidates: data.candidates ?? [],
        scannedAt: data.scannedAt ?? null,
        durationMs: data.durationMs ?? null,
        totalFound: data.totalFound ?? null,
        truncated: data.truncated ?? false,
        loading: false,
        error: null
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  return { ...state, discover };
}
