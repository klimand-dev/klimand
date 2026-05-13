"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

function truncateMiddle(s: string, max = 60): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(s.length - keep)}`;
}

export interface ProjectBarProps {
  threadId: string | null;
}

interface ThreadResponse {
  thread?: { projectPath?: string };
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

export function ProjectBar({ threadId }: ProjectBarProps): React.ReactElement | null {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ThreadResponse;
      setProjectPath(data.thread?.projectPath ?? null);
    } catch {
      /* swallow */
    }
  }, [threadId]);

  useEffect(() => {
    setProjectPath(null);
    setEditing(false);
    setError(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const startEdit = useCallback(() => {
    setDraft(projectPath ?? "");
    setError(null);
    setEditing(true);
  }, [projectPath]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!threadId) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("path required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: trimmed })
      });
      if (res.ok) {
        const data = (await res.json()) as ThreadResponse;
        setProjectPath(data.thread?.projectPath ?? null);
        setEditing(false);
      } else {
        const err = (await res.json().catch(() => ({}))) as ErrorResponse;
        setError(err.message || err.error || `error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }, [draft, threadId]);

  const clear = useCallback(async () => {
    if (!threadId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/project`, { method: "DELETE" });
      if (res.ok) {
        setProjectPath(null);
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  }, [threadId, busy]);

  if (!threadId) return null;

  return (
    <div className="flex h-8 items-center gap-3 border-b border-border bg-muted/15 px-4 font-mono text-xs">
      <span className="text-muted-foreground">project</span>
      {editing ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") cancelEdit();
            }}
            placeholder="C:\\path\\to\\project"
            className="flex-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={busy}
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted disabled:opacity-50"
          >
            {busy ? "saving…" : "save"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            cancel
          </button>
        </>
      ) : projectPath ? (
        <>
          <span className="truncate text-foreground" title={projectPath}>
            {truncateMiddle(projectPath)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={startEdit}
            className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:text-foreground"
          >
            change
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            clear
          </button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">(none — sandbox only)</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={startEdit}
            className="rounded border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted"
          >
            set project
          </button>
        </>
      )}
      {error ? <span className="ml-2 truncate text-red-400" title={error}>{error}</span> : null}
    </div>
  );
}
