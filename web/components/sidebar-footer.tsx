"use client";

import { useEffect, useState } from "react";
import { SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FooterPrefs {
  license?: {
    status?: "active" | "trial" | "expired" | "unknown";
  };
}

interface FooterDoctor {
  claude?: { installed: boolean; authenticated?: boolean };
  codex?: { installed: boolean; authenticated?: boolean };
}

type Health = "ok" | "degraded" | "down" | "unknown";

function deriveHealth(d: FooterDoctor | null): Health {
  if (!d) return "unknown";
  const cs = [d.claude, d.codex].filter(Boolean) as Array<NonNullable<FooterDoctor["claude"]>>;
  if (cs.length === 0) return "unknown";
  const allHealthy = cs.every((c) => c.installed && c.authenticated !== false);
  if (allHealthy) return "ok";
  const someHealthy = cs.some((c) => c.installed);
  return someHealthy ? "degraded" : "down";
}

function deriveTier(p: FooterPrefs | null): "Pro" | "Free" {
  if (p?.license?.status === "active") return "Pro";
  return "Free";
}

export function SidebarFooter({
  active,
  onOpenSettings
}: {
  active: boolean;
  onOpenSettings: () => void;
}): React.ReactElement {
  const [prefs, setPrefs] = useState<FooterPrefs | null>(null);
  const [doctor, setDoctor] = useState<FooterDoctor | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/prefs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setPrefs(data);
      })
      .catch(() => {});
    fetch("/api/doctor", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setDoctor(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tier = deriveTier(prefs);
  const health = deriveHealth(doctor);

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      title="Open settings"
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[11px] font-semibold text-accent"
        )}
        aria-hidden
      >
        <SettingsIcon className="h-3.5 w-3.5" />
      </span>
      <span className="flex flex-1 flex-col gap-0">
        <span className="text-xs font-medium leading-tight">Settings</span>
        <span className="font-mono text-[10px] leading-tight text-muted-foreground">
          {tier}
        </span>
      </span>
      <HealthDot health={health} />
    </button>
  );
}

function HealthDot({ health }: { health: Health }): React.ReactElement {
  const color =
    health === "ok"
      ? "bg-emerald-500"
      : health === "degraded"
        ? "bg-amber-500"
        : health === "down"
          ? "bg-red-500"
          : "bg-muted-foreground/40";
  const label =
    health === "ok"
      ? "All CLIs healthy"
      : health === "degraded"
        ? "Some CLIs unavailable"
        : health === "down"
          ? "No CLIs available"
          : "CLI status unknown";
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", color)}
      aria-label={label}
      title={label}
    />
  );
}
