"use client";

import { useCallback, useEffect, useState } from "react";

export type LicenseStatus = "active" | "trial" | "expired" | "unknown";

export interface LicenseState {
  key: string | null;
  status: LicenseStatus;
  verifiedAt: string | null;
  isPro: boolean;
}

const INITIAL: LicenseState = { key: null, status: "unknown", verifiedAt: null, isPro: false };

export interface UseLicense extends LicenseState {
  loading: boolean;
  setKey: (key: string | null) => Promise<LicenseState>;
  verify: () => Promise<LicenseState>;
}

export function useLicense(): UseLicense {
  const [state, setState] = useState<LicenseState>(INITIAL);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/license", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as LicenseState);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(async (key: string | null) => {
    const res = await fetch("/api/license", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, action: key ? "set" : "clear" })
    });
    const next = (await res.json()) as LicenseState;
    setState(next);
    return next;
  }, []);

  const verify = useCallback(async () => {
    const res = await fetch("/api/license", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify" })
    });
    const next = (await res.json()) as LicenseState;
    setState(next);
    return next;
  }, []);

  return { ...state, loading, setKey, verify };
}
