"use client";

import Image from "next/image";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type ProviderId = "claude" | "codex";

interface ProviderBrandProps {
  provider: ProviderId;
  workspace?: string;
  status?: "pending" | "running" | "done" | "failed" | "cancelled";
  onCancel?: () => void;
  cancelInFlight?: boolean;
  className?: string;
}

const STATUS_COLOR: Record<NonNullable<ProviderBrandProps["status"]>, string> = {
  pending: "text-muted-foreground",
  running: "text-accent",
  done: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-muted-foreground"
};

export function ProviderBrand({
  provider,
  workspace,
  status,
  onCancel,
  cancelInFlight,
  className
}: ProviderBrandProps): ReactElement {
  const showCancel = status === "running" && typeof onCancel === "function";
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border bg-card/60 px-3 py-2",
        className
      )}
    >
      <BrandMark provider={provider} />
      <BrandWordmark provider={provider} />
      <div className="h-4 w-px bg-border" aria-hidden />
      <div className="flex-1 truncate font-mono text-xs text-muted-foreground">
        {workspace ? <>running in {workspace}</> : "running"}
      </div>
      {status ? (
        <span className={cn("font-mono text-xs uppercase tracking-wide", STATUS_COLOR[status])}>{status}</span>
      ) : null}
      {showCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelInFlight}
          className={cn(
            "rounded border border-border px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-muted-foreground",
            "hover:border-red-400 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          )}
          aria-label="Cancel running CLI call"
        >
          {cancelInFlight ? "cancelling…" : "cancel"}
        </button>
      ) : null}
    </div>
  );
}

function BrandMark({ provider }: { provider: ProviderId }): ReactElement {
  if (provider === "claude") {
    return (
      <Image
        src="/brands/claude.svg"
        alt="Claude"
        width={18}
        height={18}
        style={{ filter: "invert(56%) sepia(43%) saturate(750%) hue-rotate(338deg) brightness(91%) contrast(89%)" }}
        aria-hidden
      />
    );
  }
  return (
    <Image
      src="/brands/openai.svg"
      alt="OpenAI"
      width={18}
      height={18}
      style={{ filter: "invert(100%)" }}
      aria-hidden
    />
  );
}

function BrandWordmark({ provider }: { provider: ProviderId }): ReactElement {
  if (provider === "claude") {
    return (
      <span className="font-semibold text-foreground">
        Claude Code
      </span>
    );
  }
  return (
    <span className="font-semibold text-foreground">
      OpenAI · Codex
    </span>
  );
}
