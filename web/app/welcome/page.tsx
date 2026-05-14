"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderIcon, CheckIcon, RefreshCwIcon, ChevronRightIcon } from "lucide-react";
import { useProjectRegistry } from "@/lib/use-project-registry";
import { useProjectDiscovery, type ProjectCandidate } from "@/lib/use-project-discovery";
import { cn } from "@/lib/utils";

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function homeShortPath(p: string): string {
  return p.replace(/^C:\\Users\\[^\\]+/i, "~").replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export default function WelcomePage(): React.ReactElement {
  const router = useRouter();
  const { registry, approve } = useProjectRegistry();
  const discovery = useProjectDiscovery();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void discovery.discover();
  }, [discovery]);

  // Pre-select everything once discovery comes back.
  useEffect(() => {
    if (!discovery.scannedAt || discovery.candidates.length === 0) return;
    setSelected((cur) => {
      if (cur.size > 0) return cur;
      const approvedSet = new Set(registry.approved.map((e) => e.path));
      const next = new Set<string>();
      for (const c of discovery.candidates) {
        if (!approvedSet.has(c.path)) next.add(c.path);
      }
      return next;
    });
  }, [discovery.scannedAt, discovery.candidates, registry.approved]);

  const candidates: ProjectCandidate[] = useMemo(() => {
    const approvedSet = new Set(registry.approved.map((e) => e.path));
    return discovery.candidates.filter((c) => !approvedSet.has(c.path));
  }, [discovery.candidates, registry.approved]);

  const toggle = useCallback((p: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(candidates.map((c) => c.path)));
  }, [candidates]);

  const selectNone = useCallback(() => setSelected(new Set()), []);

  const approveSelected = useCallback(async () => {
    if (selected.size === 0) {
      router.replace("/");
      return;
    }
    setBusy(true);
    try {
      for (const path of selected) {
        await approve(path);
      }
      setDone(true);
      setTimeout(() => router.replace("/"), 400);
    } finally {
      setBusy(false);
    }
  }, [approve, router, selected]);

  const skip = useCallback(() => router.replace("/"), [router]);

  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-8">
          <div className="font-mono text-sm font-semibold text-accent">Klimand</div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Welcome — let's set up your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Klimand scanned your home directory and looked for folders that contain agent configuration
            (<code className="font-mono text-xs">CLAUDE.md</code>, <code className="font-mono text-xs">AGENTS.md</code>,{" "}
            <code className="font-mono text-xs">.claude/</code>, <code className="font-mono text-xs">.codex/</code>,{" "}
            <code className="font-mono text-xs">.mcp.json</code>, or a git repo). Approve the ones you want Klimand to
            track — you can change this anytime from the project picker.
          </p>
        </header>

        <section className="rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>
              {discovery.loading
                ? "Scanning…"
                : discovery.error
                ? `Discovery failed: ${discovery.error}`
                : `${candidates.length} project${candidates.length === 1 ? "" : "s"} found · ${selected.size} selected`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void discovery.discover(true)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
                disabled={discovery.loading || busy}
              >
                <RefreshCwIcon className={cn("h-3 w-3", discovery.loading && "animate-spin")} />
                rescan
              </button>
              <button
                type="button"
                onClick={selectAll}
                className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
                disabled={busy}
              >
                select all
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
                disabled={busy}
              >
                clear
              </button>
            </div>
          </div>
          <ul className="max-h-[55vh] overflow-y-auto">
            {candidates.length === 0 && !discovery.loading ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No projects found yet. You can rescan, or click <strong>Continue</strong> and add a project manually later.
              </li>
            ) : null}
            {candidates.map((c) => {
              const isSel = selected.has(c.path);
              return (
                <li key={c.path}>
                  <button
                    type="button"
                    onClick={() => toggle(c.path)}
                    disabled={busy}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border/40 px-4 py-2 text-left text-sm last:border-b-0",
                      isSel ? "bg-muted/50" : "hover:bg-muted/30"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        isSel ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background"
                      )}
                    >
                      {isSel ? <CheckIcon className="h-3 w-3" /> : null}
                    </span>
                    <FolderIcon className="h-4 w-4 opacity-50" />
                    <span className="flex-1 truncate">
                      <span className="font-medium text-foreground">{c.label || basename(c.path)}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{homeShortPath(c.parentDir)}</span>
                    </span>
                    <span className="hidden flex-shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
                      {c.markers.slice(0, 3).join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Skip — I'll add later
          </button>
          <button
            type="button"
            onClick={approveSelected}
            disabled={busy || discovery.loading}
            className="flex items-center gap-2 rounded bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {done ? (
              <>
                <CheckIcon className="h-4 w-4" /> Done
              </>
            ) : busy ? (
              "Approving…"
            ) : (
              <>
                {selected.size > 0 ? `Approve ${selected.size} and continue` : "Continue"}
                <ChevronRightIcon className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          You can rerun this from the project picker anytime — just click the dropdown at the top of any thread.
        </p>
      </div>
    </main>
  );
}
