"use client";

import { useEffect, useRef, useState } from "react";

export interface PendingApprovalSnapshot {
  prompt: string;
  provider: "claude" | "codex";
  threadId?: string;
}

export interface ToolOutputSnapshot {
  found: boolean;
  stdout?: string;
  stderr?: string;
  complete?: boolean;
  cancelled?: boolean;
  exitCode?: number | null;
  durationMs?: number | null;
  command?: string | null;
  cwd?: string | null;
  provider?: "claude" | "codex" | null;
  pendingApproval?: PendingApprovalSnapshot | null;
}

const ACTIVE_POLL_MS = 600;
const SETTLE_POLL_MS = 200;

export function useToolOutput(toolCallId: string | undefined, hasResult: boolean): ToolOutputSnapshot {
  const [snapshot, setSnapshot] = useState<ToolOutputSnapshot>({ found: false });
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!toolCallId) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/tool-output/${encodeURIComponent(toolCallId)}`, {
          cache: "no-store"
        });
        if (cancelled) return;
        if (res.status === 404) {
          setSnapshot({ found: false });
        } else if (res.ok) {
          const data = (await res.json()) as ToolOutputSnapshot;
          if (!cancelled) setSnapshot(data);
          if (data.complete) {
            // One last poll already done; we can stop.
            stoppedRef.current = true;
            return;
          }
        }
      } catch {
        /* swallow transient errors */
      }
      if (!cancelled && !stoppedRef.current) {
        const interval = hasResult ? SETTLE_POLL_MS : ACTIVE_POLL_MS;
        timer = setTimeout(tick, interval);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [toolCallId, hasResult]);

  return snapshot;
}
