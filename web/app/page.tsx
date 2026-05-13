"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Assistant } from "@/components/assistant";
import { SandboxBar } from "@/components/sandbox-bar";
import { ProjectBar } from "@/components/project-bar";
import { AgentProfilePanel } from "@/components/agent-profile-panel";
import { MobilePanelTrigger } from "@/components/mobile-panel-trigger";
import { ThreadList } from "@/components/thread-list";
import { ScheduledRunsView } from "@/components/scheduled-runs-view";
import { useThreads } from "@/lib/use-threads";

const CURRENT_THREAD_KEY = "agentchain:current-thread";

export default function Page(): React.ReactElement {
  const { threads, loading, create, remove, rename } = useThreads();
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Pick a thread once the list loads. Prefer localStorage selection, else first thread,
  // else create a default chat thread.
  useEffect(() => {
    if (loading) return;
    if (currentId && threads.some((t) => t.id === currentId)) return;
    let restored: string | null = null;
    try {
      restored = localStorage.getItem(CURRENT_THREAD_KEY);
    } catch {
      /* swallow */
    }
    const match = restored ? threads.find((t) => t.id === restored) : null;
    if (match) {
      setCurrentId(match.id);
      return;
    }
    if (threads.length > 0) {
      setCurrentId(threads[0]!.id);
      return;
    }
    create().then((t) => {
      if (t) setCurrentId(t.id);
    });
  }, [loading, threads, currentId, create]);

  useEffect(() => {
    if (!currentId) return;
    try {
      localStorage.setItem(CURRENT_THREAD_KEY, currentId);
    } catch {
      /* swallow */
    }
  }, [currentId]);

  const handleCreate = useCallback(async () => {
    const t = await create();
    if (t) setCurrentId(t.id);
  }, [create]);

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
      if (id === currentId) {
        setCurrentId(null);
      }
    },
    [remove, currentId]
  );

  const currentKind = useMemo(() => {
    if (!currentId) return "chat" as const;
    const found = threads.find((t) => t.id === currentId);
    return found?.kind ?? "chat";
  }, [currentId, threads]);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <MobilePanelTrigger
          threads={threads}
          currentId={currentId}
          onSelect={setCurrentId}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onRename={rename}
        />
        <div className="font-mono text-sm font-semibold text-accent">AgentChain</div>
        <div className="text-xs text-muted-foreground">chat-driven orchestration</div>
      </header>
      <SandboxBar threadId={currentId} />
      <ProjectBar threadId={currentId} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:flex w-[clamp(320px,33%,440px)] flex-col border-r border-border">
          <div className="border-b border-border">
            <ThreadList
              threads={threads}
              currentId={currentId}
              onSelect={setCurrentId}
              onCreate={handleCreate}
              onDelete={handleDelete}
              onRename={rename}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            <AgentProfilePanel className="h-full w-full" />
          </div>
        </aside>
        <div className="flex-1 overflow-hidden">
          {currentId ? (
            <ThreadView key={currentId} threadId={currentId} kind={currentKind} />
          ) : (
            <ThreadFallback />
          )}
        </div>
      </div>
    </main>
  );
}

function ThreadFallback(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
      loading thread…
    </div>
  );
}

function ThreadView({
  threadId,
  kind
}: {
  threadId: string;
  kind: "chat" | "scheduled";
}): React.ReactElement {
  if (kind === "scheduled") {
    return <ScheduledRunsView threadId={threadId} />;
  }
  return <Assistant threadId={threadId} />;
}
