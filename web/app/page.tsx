"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Assistant } from "@/components/assistant";
import { SandboxBar } from "@/components/sandbox-bar";
import { ProjectBar } from "@/components/project-bar";
import { AgentProfilePanel } from "@/components/agent-profile-panel";
import { MobilePanelTrigger } from "@/components/mobile-panel-trigger";
import { ThreadList } from "@/components/thread-list";
import { ScheduledRunsView } from "@/components/scheduled-runs-view";
import { ProjectView } from "@/components/project-view";
import { useThreads } from "@/lib/use-threads";
import { useProjectRegistry } from "@/lib/use-project-registry";
import type { ApprovedRef } from "@/lib/projects";

const CURRENT_THREAD_KEY = "klimand:current-thread";
const CURRENT_VIEW_KEY = "klimand:current-view";

type View = { kind: "thread"; threadId: string } | { kind: "project"; path: string };

function loadStoredView(): View | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CURRENT_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as View;
    if (parsed && (parsed.kind === "thread" || parsed.kind === "project")) return parsed;
  } catch {
    /* swallow */
  }
  return null;
}

export default function Page(): React.ReactElement {
  const router = useRouter();
  const { threads, loading, create, createIngest, remove, rename } = useThreads();
  const { registry, loading: registryLoading } = useProjectRegistry();
  const approved: ApprovedRef[] = useMemo(
    () => registry.approved.map((e) => ({ path: e.path, label: e.label, lastUsed: e.lastUsed })),
    [registry.approved]
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setViewState] = useState<View | null>(null);

  // First-run redirect: empty registry + no thread bound to any project → welcome.
  useEffect(() => {
    if (loading || registryLoading) return;
    if (typeof window === "undefined") return;
    const flag = localStorage.getItem("klimand:welcome-seen");
    if (flag) return;
    const noApproved = registry.approved.length === 0;
    const noBoundThreads = threads.every((t) => !t.projectPath);
    if (noApproved && noBoundThreads) {
      localStorage.setItem("klimand:welcome-seen", "1");
      router.replace("/welcome");
    }
  }, [loading, registryLoading, registry.approved.length, threads, router]);

  const setView = useCallback((next: View | null) => {
    setViewState(next);
    try {
      if (next) localStorage.setItem(CURRENT_VIEW_KEY, JSON.stringify(next));
      else localStorage.removeItem(CURRENT_VIEW_KEY);
    } catch {
      /* swallow */
    }
  }, []);

  // Pick a thread once the list loads.
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

  // Once threads load, restore the persisted view (if any) — otherwise default to current thread.
  useEffect(() => {
    if (loading || view) return;
    const stored = loadStoredView();
    if (stored) {
      if (stored.kind === "thread") {
        if (threads.some((t) => t.id === stored.threadId)) {
          setViewState(stored);
          return;
        }
      } else if (stored.kind === "project") {
        if (threads.some((t) => t.projectPath === stored.path)) {
          setViewState(stored);
          return;
        }
      }
    }
    if (currentId) setViewState({ kind: "thread", threadId: currentId });
  }, [loading, threads, view, currentId]);

  useEffect(() => {
    if (!currentId) return;
    try {
      localStorage.setItem(CURRENT_THREAD_KEY, currentId);
    } catch {
      /* swallow */
    }
  }, [currentId]);

  const handleSelectThread = useCallback(
    (id: string) => {
      setCurrentId(id);
      setView({ kind: "thread", threadId: id });
    },
    [setView]
  );

  const handleSelectProject = useCallback(
    (p: string) => {
      setView({ kind: "project", path: p });
    },
    [setView]
  );

  const handleCreate = useCallback(async () => {
    const t = await create();
    if (t) {
      setCurrentId(t.id);
      setView({ kind: "thread", threadId: t.id });
    }
  }, [create, setView]);

  const handleCreateFromUrl = useCallback(
    async (url: string): Promise<{ ok: boolean; error?: string }> => {
      const result = await createIngest(url);
      if (result.thread) {
        setCurrentId(result.thread.id);
        setView({ kind: "thread", threadId: result.thread.id });
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [createIngest, setView]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
      if (id === currentId) {
        setCurrentId(null);
        setView(null);
      }
    },
    [remove, currentId, setView]
  );

  const currentKind = useMemo(() => {
    if (!currentId) return "chat" as const;
    const found = threads.find((t) => t.id === currentId);
    return found?.kind ?? "chat";
  }, [currentId, threads]);

  const currentProjectPath = useMemo(() => {
    if (view?.kind === "project") return view.path;
    if (currentId) {
      const t = threads.find((x) => x.id === currentId);
      return t?.projectPath ?? null;
    }
    return null;
  }, [view, currentId, threads]);

  const threadsInProject = useMemo(() => {
    if (view?.kind !== "project") return [];
    return threads.filter((t) => t.projectPath === view.path && t.kind === "chat");
  }, [view, threads]);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <MobilePanelTrigger
          threads={threads}
          approved={approved}
          currentId={currentId}
          currentProjectPath={view?.kind === "project" ? view.path : null}
          onSelect={handleSelectThread}
          onCreate={handleCreate}
          onCreateFromUrl={handleCreateFromUrl}
          onDelete={handleDelete}
          onRename={rename}
          onSelectProject={handleSelectProject}
        />
        <div className="font-mono text-sm font-semibold text-accent">Klimand</div>
        <div className="text-xs text-muted-foreground">chat-driven orchestration</div>
      </header>
      {view?.kind === "thread" ? (
        <>
          <SandboxBar threadId={currentId} />
          <ProjectBar threadId={currentId} onViewProject={handleSelectProject} />
        </>
      ) : null}
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:flex w-[clamp(320px,33%,440px)] flex-col border-r border-border">
          <div className="border-b border-border overflow-y-auto">
            <ThreadList
              threads={threads}
              approved={approved}
              currentId={currentId}
              currentProjectPath={view?.kind === "project" ? view.path : null}
              onSelect={handleSelectThread}
              onCreate={handleCreate}
              onCreateFromUrl={handleCreateFromUrl}
              onDelete={handleDelete}
              onRename={rename}
              onSelectProject={handleSelectProject}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            <AgentProfilePanel className="h-full w-full" />
          </div>
        </aside>
        <div className="flex-1 overflow-hidden">
          {view?.kind === "project" ? (
            <ProjectView
              key={view.path}
              path={view.path}
              threadsInProject={threadsInProject}
              onSelectThread={handleSelectThread}
            />
          ) : currentId ? (
            <ThreadView key={currentId} threadId={currentId} kind={currentKind} />
          ) : (
            <ThreadFallback />
          )}
        </div>
      </div>
      {/* currentProjectPath inferred but only consumed inside ProjectBar via thread fetch; ref used in ThreadList */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
      {currentProjectPath ? null : null}
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
