"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider, Tools, useAui } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/thread";
import { toolkit } from "@/components/toolkit";
import { GoalSuggestBanner } from "@/components/goal-suggest-banner";
import { GoalTracker } from "@/components/goal-tracker";
import { useThreadGoal } from "@/lib/use-thread-goal";

interface AssistantProps {
  threadId: string;
}

function messagesKey(threadId: string): string {
  return `klimand:thread:${threadId}:messages`;
}

function loadInitialMessages(threadId: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(messagesKey(threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as UIMessage[];
  } catch {
    /* swallow — corrupt entry, start fresh */
  }
  return [];
}

function saveMessages(threadId: string, messages: UIMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(messagesKey(threadId), JSON.stringify(messages));
  } catch {
    /* quota or serialization — skip; next turn will retry */
  }
}

export function Assistant({ threadId }: AssistantProps): React.ReactElement {
  const initialMessages = useMemo(() => loadInitialMessages(threadId), [threadId]);
  const { goal, refresh: refreshGoal } = useThreadGoal(threadId);

  const runtime = useChatRuntime({
    id: threadId,
    messages: initialMessages,
    transport: new AssistantChatTransport({
      api: `/api/chat?threadId=${encodeURIComponent(threadId)}`
    }),
    onFinish: ({ messages }) => {
      saveMessages(threadId, messages);
    }
  });
  const aui = useAui({ tools: Tools({ toolkit }) });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <div className="flex h-full flex-col">
        <div className="flex flex-col gap-2 px-4 pt-3">
          {goal ? (
            <GoalTracker goalId={goal.id} />
          ) : (
            <GoalSuggestBanner threadId={threadId} onGoalStarted={refreshGoal} />
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
