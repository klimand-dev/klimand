"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { TargetIcon, XIcon } from "lucide-react";
import { detectGoalShape } from "@/lib/goal-shape-detector";

interface AnyMessagePart {
  type: string;
  text?: string;
}

interface ThreadMessageLike {
  role: string;
  parts?: AnyMessagePart[];
}

/**
 * Banner that surfaces above the chat when the first user turn looks goal-shaped.
 * Goal mode is "coming later" — the banner is informational and dismissible.
 */
export function GoalSuggestBanner({ threadId }: { threadId: string }): React.ReactElement | null {
  const messages = useAuiState((s) => (s.thread.messages as unknown) as ThreadMessageLike[]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(`klimand:goal-banner-dismissed:${threadId}`) === "1");
  }, [threadId]);

  if (dismissed) return null;

  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;
  const text = (firstUser.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ")
    .trim();
  const signal = detectGoalShape(text);
  if (!signal.isGoalShaped) return null;
  if (signal.confidence === "low") return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`klimand:goal-banner-dismissed:${threadId}`, "1");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-(--thread-max-width) items-start gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2">
      <TargetIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
      <div className="flex-1">
        <div className="font-mono text-xs font-semibold text-foreground">
          This looks like a multi-step goal.
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          Goal mode runs the work durably across both CLIs and wakes you when it's done.{" "}
          <span className="italic">Coming later — for now, Klimand handles each turn synchronously.</span>
        </div>
      </div>
      <button
        type="button"
        title="Dismiss"
        onClick={dismiss}
        className="rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
