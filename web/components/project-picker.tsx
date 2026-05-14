"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
  MinusIcon,
  CheckIcon
} from "lucide-react";
import { useProjectRegistry, type ProjectEntry } from "@/lib/use-project-registry";
import { useProjectDiscovery, type ProjectCandidate } from "@/lib/use-project-discovery";
import { cn } from "@/lib/utils";

export interface ProjectPickerProps {
  value: string | null;
  onSelect: (path: string | null) => void;
  className?: string;
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function homeShortPath(p: string): string {
  if (typeof window === "undefined") return p;
  // We can't read os.homedir in browser; approximate by collapsing common patterns.
  return p.replace(/^C:\\Users\\[^\\]+/i, "~").replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function truncateMiddle(s: string, max = 48): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(s.length - keep)}`;
}

export function ProjectPicker({ value, onSelect, className }: ProjectPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const { registry, approve, remove, hide } = useProjectRegistry();
  const discovery = useProjectDiscovery();

  // When opened: run discovery if we haven't yet (or cache may be empty).
  useEffect(() => {
    if (open && discovery.scannedAt === null && !discovery.loading) {
      void discovery.discover();
    }
  }, [open, discovery]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setManualMode(false);
        setManualError(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (manualMode && manualInputRef.current) manualInputRef.current.focus();
  }, [manualMode]);

  const approved: ProjectEntry[] = useMemo(() => {
    const list = [...registry.approved];
    list.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
    return list;
  }, [registry.approved]);

  const suggested: ProjectCandidate[] = useMemo(() => {
    const approvedSet = new Set(registry.approved.map((e) => e.path));
    const hiddenSet = new Set(registry.hidden);
    return discovery.candidates.filter((c) => !approvedSet.has(c.path) && !hiddenSet.has(c.path));
  }, [discovery.candidates, registry]);

  const currentLabel = useMemo(() => {
    if (!value) return null;
    const match = registry.approved.find((e) => e.path === value);
    return match?.label ?? (basename(value) || value);
  }, [value, registry.approved]);

  const handleSelect = useCallback(
    (p: string) => {
      onSelect(p);
      setOpen(false);
    },
    [onSelect]
  );

  const handleApproveCandidate = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        const result = await approve(p);
        if (!result.ok) return;
      } finally {
        setBusy(false);
      }
    },
    [approve]
  );

  const handleApproveAndSelect = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        const result = await approve(p);
        if (result.ok) {
          onSelect(p);
          setOpen(false);
        }
      } finally {
        setBusy(false);
      }
    },
    [approve, onSelect]
  );

  const handleManualSave = useCallback(async () => {
    const trimmed = manualDraft.trim();
    if (!trimmed) {
      setManualError("path required");
      return;
    }
    setBusy(true);
    setManualError(null);
    try {
      const result = await approve(trimmed);
      if (!result.ok) {
        setManualError(result.error ?? "could not add path");
        return;
      }
      onSelect(trimmed);
      setManualDraft("");
      setManualMode(false);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [approve, manualDraft, onSelect]);

  const handleClear = useCallback(() => {
    onSelect(null);
    setOpen(false);
  }, [onSelect]);

  return (
    <div ref={wrapRef} className={cn("relative flex flex-1 items-center", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-1 items-center gap-1.5 rounded border border-border bg-background px-2 py-0.5 text-left font-mono text-xs text-foreground hover:bg-muted"
        title={value ?? "(no project)"}
      >
        {value ? <FolderOpenIcon className="h-3 w-3 opacity-70" /> : <FolderIcon className="h-3 w-3 opacity-50" />}
        <span className="flex-1 truncate">
          {value ? (
            <>
              <span className="font-medium">{currentLabel}</span>
              <span className="ml-2 truncate text-muted-foreground">{truncateMiddle(homeShortPath(value), 40)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">(none — sandbox only)</span>
          )}
        </span>
        {open ? (
          <ChevronUpIcon className="h-3 w-3 opacity-70" />
        ) : (
          <ChevronDownIcon className="h-3 w-3 opacity-70" />
        )}
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[min(560px,90vw)] overflow-hidden rounded-md border border-border bg-card shadow-lg"
          role="listbox"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <PickerSection
              title={`In your workspace (${approved.length})`}
              empty="No approved projects yet. Pick from suggestions below or add by path."
            >
              {approved.map((entry) => (
                <ApprovedRow
                  key={`a:${entry.path}`}
                  entry={entry}
                  active={value === entry.path}
                  busy={busy}
                  onSelect={() => handleSelect(entry.path)}
                  onRemove={async () => {
                    setBusy(true);
                    try {
                      await remove(entry.path);
                      if (value === entry.path) onSelect(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ))}
            </PickerSection>

            <div className="border-t border-border" />

            <PickerSection
              title={`Suggested (${suggested.length})`}
              empty={
                discovery.loading
                  ? "Scanning…"
                  : discovery.error
                  ? `Discovery failed: ${discovery.error}`
                  : "No new projects found in common locations."
              }
              action={
                <button
                  type="button"
                  onClick={() => void discovery.discover(true)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  disabled={discovery.loading}
                  title="Rescan"
                >
                  <RefreshCwIcon className={cn("h-3 w-3", discovery.loading && "animate-spin")} />
                  rescan
                </button>
              }
            >
              {suggested.map((c) => (
                <SuggestedRow
                  key={`s:${c.path}`}
                  candidate={c}
                  busy={busy}
                  onApproveAndSelect={() => void handleApproveAndSelect(c.path)}
                  onApprove={() => void handleApproveCandidate(c.path)}
                  onDismiss={async () => {
                    setBusy(true);
                    try {
                      await hide(c.path);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ))}
            </PickerSection>
          </div>

          <div className="border-t border-border bg-muted/20 px-2 py-2">
            {manualMode ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    ref={manualInputRef}
                    type="text"
                    value={manualDraft}
                    onChange={(e) => setManualDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleManualSave();
                      if (e.key === "Escape") {
                        setManualMode(false);
                        setManualError(null);
                      }
                    }}
                    placeholder="C:\\path\\to\\project"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => void handleManualSave()}
                    disabled={busy}
                    className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <CheckIcon className="h-3 w-3" />
                    add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode(false);
                      setManualError(null);
                    }}
                    disabled={busy}
                    className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    cancel
                  </button>
                </div>
                {manualError ? (
                  <span className="font-mono text-[10px] text-red-400" title={manualError}>
                    {manualError}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground hover:bg-muted"
                >
                  <PlusIcon className="h-3 w-3" />
                  Add by path…
                </button>
                {value ? (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Clear (sandbox)
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerSection({
  title,
  empty,
  action,
  children
}: {
  title: string;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      {hasContent ? (
        <div className="flex flex-col">{children}</div>
      ) : (
        <div className="px-3 pb-2 text-xs italic text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

function ApprovedRow({
  entry,
  active,
  busy,
  onSelect,
  onRemove
}: {
  entry: ProjectEntry;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onRemove: () => void;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-1.5 text-xs",
        active ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/50"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 truncate text-left"
        title={entry.path}
      >
        <span className="flex h-3 w-3 items-center justify-center">
          {active ? <CheckIcon className="h-3 w-3 text-accent" /> : <FolderIcon className="h-3 w-3 opacity-60" />}
        </span>
        <span className="font-mono text-xs font-medium">{entry.label}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {truncateMiddle(homeShortPath(entry.path), 40)}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 disabled:opacity-30"
        aria-label="Remove from workspace"
        title="Remove from workspace"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SuggestedRow({
  candidate,
  busy,
  onApproveAndSelect,
  onApprove,
  onDismiss
}: {
  candidate: ProjectCandidate;
  busy: boolean;
  onApproveAndSelect: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40">
      <button
        type="button"
        onClick={onApproveAndSelect}
        className="flex flex-1 items-center gap-2 truncate text-left hover:text-foreground"
        title={`${candidate.path}\nMarkers: ${candidate.markers.join(", ")}`}
      >
        <FolderIcon className="h-3 w-3 opacity-50" />
        <span className="font-mono text-xs font-medium">{candidate.label}</span>
        <span className="truncate font-mono text-[10px]">
          {truncateMiddle(homeShortPath(candidate.parentDir), 36)}
        </span>
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 hover:bg-muted disabled:opacity-30"
        aria-label="Approve (add to workspace)"
        title="Add to workspace"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 hover:bg-muted disabled:opacity-30"
        aria-label="Dismiss"
        title="Dismiss (hide from suggestions)"
      >
        <MinusIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
