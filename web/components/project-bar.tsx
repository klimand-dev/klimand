"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { ProjectPicker } from "./project-picker";

export interface ProjectBarProps {
  threadId: string | null;
  onViewProject?: (path: string) => void;
}

interface ThreadResponse {
  thread?: { projectPath?: string };
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

export function ProjectBar({ threadId, onViewProject }: ProjectBarProps): React.ReactElement | null {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    refresh();
  }, [refresh]);

  const handleSelect = useCallback(
    async (next: string | null) => {
      if (!threadId) return;
      setError(null);
      try {
        if (next === null) {
          const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/project`, { method: "DELETE" });
          if (res.ok) setProjectPath(null);
          return;
        }
        const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/project`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: next })
        });
        if (res.ok) {
          const data = (await res.json()) as ThreadResponse;
          setProjectPath(data.thread?.projectPath ?? null);
        } else {
          const err = (await res.json().catch(() => ({}))) as ErrorResponse;
          setError(err.message || err.error || `error ${res.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [threadId]
  );

  if (!threadId) return null;

  return (
    <div className="flex h-8 items-center gap-3 border-b border-border bg-muted/15 px-4 font-mono text-xs">
      <span className="text-muted-foreground">project</span>
      <ProjectPicker value={projectPath} onSelect={handleSelect} />
      {projectPath && onViewProject ? (
        <button
          type="button"
          onClick={() => onViewProject(projectPath)}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted"
          title="View project config"
        >
          <ExternalLinkIcon className="h-3 w-3" />
          view config
        </button>
      ) : null}
      {error ? (
        <span className="ml-2 truncate text-red-400" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
