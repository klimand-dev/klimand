"use client";

import type { Toolkit } from "@assistant-ui/react";
import { useCallback, useState, type ReactElement } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { TerminalToolCard } from "@/components/terminal-tool-card";
import { ProviderBrand, type ProviderId } from "@/components/provider-brand";
import { ApprovalCard } from "@/components/approval-card";
import { PlainMarkdown } from "@/components/markdown-text";
import { useToolOutput } from "@/lib/use-tool-output";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface CliArgs {
  prompt?: string;
  workspace?: string;
}

interface AgentResultSummary {
  provider?: "claude" | "codex";
  final_text?: string;
  final_text_parsed?: boolean;
  exit_code?: number;
  duration_ms?: number;
  notes?: string[];
}

type ToolStatus = { type?: string };

function statusFor(
  hasResult: boolean,
  exitCode: number | null | undefined,
  status: ToolStatus | undefined,
  brokerComplete: boolean,
  brokerCancelled: boolean
): "pending" | "running" | "done" | "failed" | "cancelled" {
  if (hasResult || brokerComplete) {
    if (brokerCancelled) return "cancelled";
    if ((exitCode ?? 0) !== 0) return "failed";
    return "done";
  }
  const t = status?.type ?? "";
  if (t === "running" || t === "executing" || t === "in_progress") return "running";
  return "running"; // tool call has been dispatched — show as running
}

export function AgentToolCard({
  provider,
  args,
  result,
  status,
  toolCallId
}: {
  provider: ProviderId;
  args: CliArgs | undefined;
  result: AgentResultSummary | undefined;
  status: ToolStatus | undefined;
  toolCallId: string;
}): ReactElement {
  const live = useToolOutput(toolCallId, Boolean(result));
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const stdout = live.stdout ?? "";
  const stderr = live.stderr ?? "";
  const exitCode = live.exitCode ?? result?.exit_code ?? 0;
  const durationMs = live.durationMs ?? result?.duration_ms;
  // Prefer the broker's actual cwd over the model's args. The model passes
  // "AUTO" as a placeholder per the sandbox contract; the server substitutes
  // the real sandbox path, which is what `live.cwd` reflects.
  const workspace = (live.cwd && live.cwd.length > 0 ? live.cwd : args?.workspace) ?? "";
  const promptPreview = args?.prompt
    ? args.prompt.length > 60
      ? `${args.prompt.slice(0, 57)}…`
      : args.prompt
    : "";
  const command =
    live.command ??
    (provider === "claude" ? `claude -p '${promptPreview}'` : `codex exec '${promptPreview}'`);
  const cardStatus = statusFor(
    Boolean(result),
    exitCode,
    status,
    live.complete ?? false,
    live.cancelled ?? false
  );

  const onCancel = useCallback(async () => {
    if (cancelInFlight) return;
    setCancelInFlight(true);
    try {
      await fetch(`/api/tool-output/${encodeURIComponent(toolCallId)}/cancel`, {
        method: "POST",
        cache: "no-store"
      });
    } catch {
      /* swallow — the next poll will reflect actual state */
    }
  }, [toolCallId, cancelInFlight]);

  if (live.pendingApproval && !live.complete) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <ProviderBrand provider={provider} workspace={workspace || undefined} status="pending" />
        <ApprovalCard
          callId={toolCallId}
          provider={live.pendingApproval.provider}
          prompt={live.pendingApproval.prompt}
        />
      </div>
    );
  }

  const finalText =
    result?.final_text_parsed && result.final_text ? result.final_text : undefined;

  return (
    <div className="flex flex-col gap-3">
      <TerminalToolCard
        provider={provider}
        workspace={workspace || undefined}
        status={cardStatus}
        onCancel={cardStatus === "running" ? onCancel : undefined}
        cancelInFlight={cancelInFlight}
        id={toolCallId}
        command={command}
        cwd={workspace || undefined}
        exitCode={exitCode}
        durationMs={durationMs}
        stdout={stdout || undefined}
        stderr={stderr || undefined}
        maxCollapsedLines={20}
      />
      {finalText && <FinalAnswerCard text={finalText} />}
    </div>
  );
}

function FinalAnswerCard({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border shadow-xs">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between border-b px-4 py-2 text-left text-xs font-medium uppercase tracking-wide"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Result
            </span>
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="text-foreground max-h-[28rem] overflow-y-auto px-4 py-3 text-sm">
            <PlainMarkdown text={text} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export const toolkit: Toolkit = {
  run_claude_code: {
    type: "backend",
    render: (props) => (
      <AgentToolCard
        provider="claude"
        args={props.args as CliArgs}
        result={props.result as AgentResultSummary | undefined}
        status={props.status}
        toolCallId={props.toolCallId}
      />
    )
  },
  run_codex: {
    type: "backend",
    render: (props) => (
      <AgentToolCard
        provider="codex"
        args={props.args as CliArgs}
        result={props.result as AgentResultSummary | undefined}
        status={props.status}
        toolCallId={props.toolCallId}
      />
    )
  }
};
