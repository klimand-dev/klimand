"use client";

import { useState } from "react";
import { SettingsIcon, XIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AgentProfilePanel } from "@/components/agent-profile-panel";
import { ThreadList } from "@/components/thread-list";
import type { Thread } from "@/lib/threads";
import type { ApprovedRef } from "@/lib/projects";
import { cn } from "@/lib/utils";

interface MobilePanelTriggerProps {
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

export function MobilePanelTrigger({
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
}: MobilePanelTriggerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        type="button"
        className={cn(
          "lg:hidden flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground"
        )}
        aria-label="Open agent profile"
      >
        <SettingsIcon className="h-4 w-4" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[min(86vw,420px)] flex-col overflow-y-auto bg-card shadow-2xl",
            "border-r border-border",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          )}
        >
          <DialogPrimitive.Title className="sr-only">Agent Profile</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </DialogPrimitive.Close>
          <div className="border-b border-border">
            <ThreadList
              threads={threads}
              approved={approved}
              currentId={currentId}
              currentProjectPath={currentProjectPath}
              onSelect={(id) => {
                onSelect(id);
                setOpen(false);
              }}
              onCreate={() => {
                onCreate();
                setOpen(false);
              }}
              onCreateFromUrl={onCreateFromUrl ? async (url) => {
                const r = await onCreateFromUrl(url);
                if (r.ok) setOpen(false);
                return r;
              } : undefined}
              onDelete={onDelete}
              onRename={onRename}
              onSelectProject={(p) => {
                onSelectProject?.(p);
                setOpen(false);
              }}
            />
          </div>
          <AgentProfilePanel />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
