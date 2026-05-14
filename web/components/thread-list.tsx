"use client";

import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, ChevronDownIcon, LinkIcon } from "lucide-react";
import type { Thread } from "@/lib/threads";
import { deriveProjects, type ApprovedRef, type ProjectGroup } from "@/lib/projects";
import { useThreadStatuses, type ThreadStatus } from "@/lib/use-thread-statuses";
import { ThreadRowStatus } from "@/components/thread-row-status";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "klimand:thread-list:collapsed";

export interface ThreadListProps {
  threads: Thread[];
  approved?: ApprovedRef[];
  currentId: string | null;
  currentProjectPath?: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateFromUrl?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSelectProject?: (path: string) => void;
}

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s]));
  } catch {
    /* swallow */
  }
}

export function ThreadList({
  threads,
  approved,
  currentId,
  currentProjectPath,
  onSelect,
  onCreate,
  onCreateFromUrl,
  onDelete,
  onRename,
  onSelectProject
}: ThreadListProps): React.ReactElement {
  const grouping = deriveProjects(threads, approved);
  // Start with the server's empty Set; rehydrate from localStorage post-mount.
  // Reading localStorage during initial render causes a hydration mismatch
  // (server has no localStorage, client may have collapsed keys persisted),
  // which flips chevron icons mid-paint.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const statuses = useThreadStatuses();

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  const renderRow = (t: Thread) => (
    <ThreadRow
      key={t.id}
      thread={t}
      active={t.id === currentId}
      status={statuses[t.id]}
      onSelect={onSelect}
      onDelete={onDelete}
      onRename={onRename}
    />
  );

  const submitUrl = async () => {
    if (!onCreateFromUrl) return;
    const trimmed = urlDraft.trim();
    if (!trimmed) {
      setUrlError("URL required");
      return;
    }
    setUrlBusy(true);
    setUrlError(null);
    try {
      const result = await onCreateFromUrl(trimmed);
      if (result.ok) {
        setUrlDraft("");
        setUrlMode(false);
      } else {
        setUrlError(result.error ?? "could not create");
      }
    } finally {
      setUrlBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex flex-1 items-center justify-center gap-2 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </button>
        {onCreateFromUrl ? (
          <button
            type="button"
            onClick={() => {
              setUrlMode((v) => !v);
              setUrlError(null);
            }}
            className="flex shrink-0 items-center justify-center gap-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Create thread from a GitHub PR / issue or Linear URL"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            from URL
          </button>
        ) : null}
      </div>
      {urlMode ? (
        <div className="flex flex-col gap-1.5 rounded border border-border bg-muted/20 p-2">
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitUrl();
              if (e.key === "Escape") {
                setUrlMode(false);
                setUrlError(null);
              }
            }}
            placeholder="https://github.com/owner/repo/pull/123"
            autoFocus
            disabled={urlBusy}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitUrl()}
              disabled={urlBusy}
              className="flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              {urlBusy ? "fetching…" : "create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlMode(false);
                setUrlError(null);
              }}
              disabled={urlBusy}
              className="rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              cancel
            </button>
          </div>
          {urlError ? <span className="font-mono text-[10px] text-red-400">{urlError}</span> : null}
        </div>
      ) : null}

      {grouping.projects.map((g) => (
        <ProjectSection
          key={`p:${g.path}`}
          group={g}
          collapsed={collapsed.has(`p:${g.path}`)}
          onToggle={() => toggle(`p:${g.path}`)}
          active={currentProjectPath === g.path}
          onSelectProject={onSelectProject}
        >
          {g.threads.length > 0 ? (
            g.threads.map(renderRow)
          ) : (
            <div className="px-2 py-1 text-[11px] italic text-muted-foreground">no chats yet</div>
          )}
        </ProjectSection>
      ))}

      <Section
        title="Sandbox / no project"
        empty="No unassigned chats"
        collapsed={collapsed.has("unassigned")}
        onToggle={() => toggle("unassigned")}
      >
        {grouping.unassigned.map(renderRow)}
      </Section>

      <Section
        title="Scheduled"
        empty="No scheduled runs"
        collapsed={collapsed.has("scheduled")}
        onToggle={() => toggle("scheduled")}
      >
        {grouping.scheduled.map(renderRow)}
      </Section>
    </div>
  );
}

function ProjectSection({
  group,
  collapsed,
  onToggle,
  active,
  onSelectProject,
  children
}: {
  group: ProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
  active: boolean;
  onSelectProject?: (path: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1.5 py-1 text-xs",
          active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/40"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-4 w-4 items-center justify-center opacity-60 hover:opacity-100"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRightIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelectProject?.(group.path)}
          className="flex flex-1 items-center gap-1.5 truncate text-left"
          title={group.path}
        >
          {active ? <FolderOpenIcon className="h-3.5 w-3.5" /> : <FolderIcon className="h-3.5 w-3.5" />}
          <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-wide">{group.label}</span>
          <span className="text-[10px] opacity-60">({group.threads.length})</span>
        </button>
      </div>
      {!collapsed ? <div className="flex flex-col gap-0.5 pl-2">{children}</div> : null}
    </div>
  );
}

function Section({
  title,
  empty,
  collapsed,
  onToggle,
  children
}: {
  title: string;
  empty: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 px-1 text-left text-[10px] font-mono uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRightIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
        {title}
      </button>
      {!collapsed ? (
        hasContent ? (
          <div className="flex flex-col gap-0.5 pl-2">{children}</div>
        ) : (
          <div className="px-1 pl-3 text-xs italic text-muted-foreground">{empty}</div>
        )
      ) : null}
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  status,
  onSelect,
  onDelete,
  onRename
}: {
  thread: Thread;
  active: boolean;
  status: ThreadStatus | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== thread.title) onRename(thread.id, next);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded px-2 py-1.5 text-sm",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      {editing ? (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                setDraft(thread.title);
                setEditing(false);
              }
            }}
            autoFocus
            className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
          />
          <button
            type="button"
            onClick={commit}
            className="opacity-60 hover:opacity-100"
            aria-label="Save name"
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(thread.title);
              setEditing(false);
            }}
            className="opacity-60 hover:opacity-100"
            aria-label="Cancel"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(thread.id)}
            onDoubleClick={() => setEditing(true)}
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
          >
            <span className="w-full truncate text-xs font-medium">{thread.title}</span>
            <span className="flex w-full items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <ThreadRowStatus status={status} />
              <span className="truncate">{relativeTime(thread.lastTouched)}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
            aria-label="Rename"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${thread.title}"? This cannot be undone.`)) onDelete(thread.id);
            }}
            className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
            aria-label="Delete thread"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
