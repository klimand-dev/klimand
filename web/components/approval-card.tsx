"use client";

import { useState } from "react";
import { CheckIcon, XIcon, PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ApprovalCardProps {
  callId: string;
  provider: "claude" | "codex";
  prompt: string;
  onResolved?: () => void;
}

export function ApprovalCard({ callId, provider, prompt, onResolved }: ApprovalCardProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt);
  const [busy, setBusy] = useState(false);

  const submit = async (decision: "approve" | "reject", editedPrompt?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/approvals/${encodeURIComponent(callId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(editedPrompt ? { editedPrompt } : {}) })
      });
      onResolved?.();
    } catch {
      /* The next poll will reflect whether the call resumed; let the UI recover from there. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-4 font-mono text-xs">
      <div className="text-muted-foreground">
        Approve {provider === "claude" ? "Claude Code" : "Codex"} invocation?
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
          className="w-full rounded border border-border bg-background p-2 text-foreground"
        />
      ) : (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-foreground">
          {prompt}
        </pre>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit("approve", editing && draft !== prompt ? draft : undefined)}
          disabled={busy}
          className={cn(
            "flex items-center gap-1 rounded border border-emerald-700 bg-emerald-900/30 px-2 py-1 text-emerald-300",
            "hover:bg-emerald-900/60 disabled:opacity-50"
          )}
        >
          <CheckIcon className="h-3.5 w-3.5" />
          {editing && draft !== prompt ? "approve edit" : "approve"}
        </button>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <PencilIcon className="h-3.5 w-3.5" />
            edit
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(prompt);
              setEditing(false);
            }}
            disabled={busy}
            className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            cancel edit
          </button>
        )}
        <button
          type="button"
          onClick={() => submit("reject")}
          disabled={busy}
          className={cn(
            "flex items-center gap-1 rounded border border-red-700 bg-red-900/30 px-2 py-1 text-red-300",
            "hover:bg-red-900/60 disabled:opacity-50"
          )}
        >
          <XIcon className="h-3.5 w-3.5" />
          reject
        </button>
        {busy ? <span className="text-muted-foreground">resolving…</span> : null}
      </div>
    </div>
  );
}
