"use client";

import React, { useCallback, useEffect, useState } from "react";

function truncateMiddle(s: string, max = 70): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(s.length - keep)}`;
}

export interface SandboxBarProps {
  threadId: string | null;
}

export function SandboxBar({ threadId }: SandboxBarProps): React.ReactElement {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const url = threadId
        ? `/api/sandbox?threadId=${encodeURIComponent(threadId)}`
        : "/api/sandbox";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { path?: string };
      if (data.path) setPath(data.path);
    } catch {
      /* swallow */
    }
  }, [threadId]);

  useEffect(() => {
    setPath(null);
    refresh();
  }, [refresh]);

  const onRotate = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rotate", ...(threadId ? { threadId } : {}) })
      });
      if (res.ok) {
        const data = (await res.json()) as { path?: string };
        if (data.path) setPath(data.path);
      }
    } finally {
      setBusy(false);
    }
  }, [threadId]);

  const onCopy = useCallback(async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [path]);

  return (
    <div className="flex h-8 items-center gap-3 border-b border-border bg-muted/30 px-4 font-mono text-xs">
      <span className="text-muted-foreground">sandbox</span>
      <span className="truncate" title={path ?? ""}>
        {path ? truncateMiddle(path) : "loading…"}
      </span>
      <button
        type="button"
        onClick={onCopy}
        disabled={!path}
        className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {copied ? "copied" : "copy"}
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onRotate}
        disabled={busy || !threadId}
        className="rounded border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted disabled:opacity-50"
      >
        {busy ? "rotating…" : "new sandbox"}
      </button>
    </div>
  );
}
