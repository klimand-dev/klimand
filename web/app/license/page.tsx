"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useLicense } from "@/lib/use-license";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

// Set at build time once you've stood up a Stripe Payment Link / Checkout
// session. Until then the "Subscribe" CTA renders as a disabled notice so
// the page doesn't lie about a Pro tier that isn't deployed yet.
const CHECKOUT_URL = process.env.NEXT_PUBLIC_KLIMAND_CHECKOUT_URL ?? "";

export default function LicensePage(): React.ReactElement {
  const { key, status, verifiedAt, isPro, loading, setKey, verify } = useLicense();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key) setDraft(key);
  }, [key]);

  // Detect Stripe Checkout return (Payment Link redirect appends ?paid=1)
  // and fire checkout_complete once per landing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "1") {
      track("checkout_complete", { surface: "license_return" });
    }
  }, []);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setKey(draft.trim() || null);
      if (next.status === "unknown" && draft.trim()) {
        setError("License key not recognized. Double-check the value from your purchase email.");
      } else if (next.status === "active" || next.status === "trial") {
        track("license_activated", { status: next.status });
      }
    } finally {
      setBusy(false);
    }
  }, [draft, setKey]);

  const handleVerify = useCallback(async () => {
    setBusy(true);
    try {
      await verify();
    } finally {
      setBusy(false);
    }
  }, [verify]);

  const handleClear = useCallback(async () => {
    setDraft("");
    await setKey(null);
  }, [setKey]);

  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-12">
      <div className="w-full max-w-2xl">
        <Link href="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">
          ← back to Klimand
        </Link>
        <header className="mt-4 mb-6">
          <h1 className="text-2xl font-semibold text-foreground">License</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Klimand is free and open source. Pro adds hosted scheduling, GitHub-backed sync, Web Push notifications, and a hosted
            LLM gateway. Paste your license key below to activate — or click <strong>Subscribe to Pro</strong> if you don't have
            one yet.
          </p>
        </header>

        <section className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                isPro
                  ? "border-emerald-400/50 text-emerald-400"
                  : status === "expired"
                  ? "border-red-400/50 text-red-400"
                  : "border-border text-muted-foreground"
              )}
            >
              {isPro ? <CheckIcon className="h-3 w-3" /> : null}
              {loading ? "checking…" : status}
            </span>
            {verifiedAt ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                verified {new Date(verifiedAt).toLocaleString()}
              </span>
            ) : null}
          </div>

          <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">License key</label>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="klmd_..."
            disabled={busy}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || draft === (key ?? "")}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? "saving…" : key ? "Update" : "Activate"}
            </button>
            <button
              type="button"
              onClick={handleVerify}
              disabled={busy || !key}
              className="flex items-center gap-1 rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCwIcon className={cn("h-3 w-3", busy && "animate-spin")} />
              Re-verify
            </button>
            {key ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={busy}
                className="rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
            <span className="flex-1" />
            {CHECKOUT_URL ? (
              <a
                href={CHECKOUT_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("pricing_click", { plan: "monthly", surface: "license_page" })}
                className="flex items-center gap-1 rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <ExternalLinkIcon className="h-3 w-3" />
                Subscribe to Pro
              </a>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Pro tier not yet deployed
              </span>
            )}
          </div>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
        </section>

        <section className="mt-6 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-foreground">Pro perks</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Hosted scheduling — your laptop can be closed and the run still fires.</li>
            <li>GitHub-backed sync of projects.json + threads across machines (your own private repo, your data).</li>
            <li>Web Push notifications when a run finishes or needs approval.</li>
            <li>Hosted LLM gateway — no API key to paste; capped at a generous monthly token budget.</li>
            <li>Premium skill packs and project templates.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
