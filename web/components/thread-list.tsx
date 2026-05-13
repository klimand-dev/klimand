"use client";

import { useState } from "react";
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XIcon } from "lucide-react";
import type { Thread } from "@/lib/threads";
import { cn } from "@/lib/utils";

export interface ThreadListProps {
  threads: Thread[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
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

export function ThreadList({
  threads,
  currentId,
  onSelect,
  onCreate,
  onDelete,
  onRename
}: ThreadListProps): React.ReactElement {
  const chats = threads.filter((t) => t.kind === "chat");
  const scheduled = threads.filter((t) => t.kind === "scheduled");

  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center justify-center gap-2 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        New chat
      </button>

      <Section title="Chats" empty="No chats yet">
        {chats.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            active={t.id === currentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </Section>

      <Section title="Scheduled" empty="No scheduled runs">
        {scheduled.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            active={t.id === currentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  empty,
  children
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}): React.ReactElement {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {hasContent ? (
        <div className="flex flex-col gap-0.5">{children}</div>
      ) : (
        <div className="px-1 text-xs italic text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onSelect,
  onDelete,
  onRename
}: {
  thread: Thread;
  active: boolean;
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
            className="flex flex-1 flex-col items-start gap-0.5 truncate text-left"
          >
            <span className="truncate text-xs font-medium">{thread.title}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {relativeTime(thread.lastTouched)}
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
