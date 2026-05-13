"use client";

import type { Toolkit } from "@assistant-ui/react";
import { useCallback, useState, type ReactElement } from "react";
import { TerminalToolCard } from "@/components/terminal-tool-card";
import { ProviderBrand, type ProviderId } from "@/components/provider-brand";
import { ApprovalCard } from "@/components/approval-card";
import { useToolOutput } from "@/lib/use-tool-output";

interface CliArgs {
  prompt?: string;
  workspace?: string;
}

interface AgentResultSummary {
  provider?: "claude" | "codex";
  final_text?: string;
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

  return (
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
