"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, RefreshCwIcon, PlayIcon, TrashIcon } from "lucide-react";
import type { Schedule } from "@/lib/schedules";
import { useSchedules } from "@/lib/use-schedules";
import { cn } from "@/lib/utils";

interface AgentPrefs {
  routingHints: string;
  approval: "auto" | "ask";
  claude: {
    model?: string;
    permissionMode?: "bypassPermissions" | "plan" | "ask";
    extraArgs?: string;
  };
  codex: {
    model?: string;
    sandboxMode?: "workspace-write" | "read-only";
    extraArgs?: string;
  };
}

interface CliStatus {
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

interface DoctorReport {
  claude: CliStatus;
  codex: CliStatus;
  checkedAt: string;
}

type Tab = "hints" | "clis" | "schedules" | "doctor";

const EMPTY_PREFS: AgentPrefs = { routingHints: "", approval: "auto", claude: {}, codex: {} };

export function AgentProfilePanel({ className }: { className?: string }): React.ReactElement {
  const [tab, setTab] = useState<Tab>("hints");
  const [prefs, setPrefs] = useState<AgentPrefs>(EMPTY_PREFS);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<number | null>(null);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/prefs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AgentPrefs;
      setPrefs(data);
    } catch {
      /* swallow */
    }
  }, []);

  const loadDoctor = useCallback(async () => {
    try {
      const res = await fetch("/api/doctor", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as DoctorReport;
      setDoctor(data);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    loadPrefs();
    loadDoctor();
  }, [loadPrefs, loadDoctor]);

  const queueSave = useCallback((next: AgentPrefs) => {
    setPrefs(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/prefs", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next)
        });
        if (res.ok) {
          const updated = (await res.json()) as AgentPrefs;
          setPrefs(updated);
          setSaveState("saved");
          window.setTimeout(() => setSaveState("idle"), 1200);
        } else {
          setSaveState("idle");
        }
      } catch {
        setSaveState("idle");
      }
    }, 400);
  }, []);

  const refreshDoctor = useCallback(async () => {
    setDoctorBusy(true);
    try {
      const res = await fetch("/api/doctor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" })
      });
      if (res.ok) {
        const data = (await res.json()) as DoctorReport;
        setDoctor(data);
      }
    } finally {
      setDoctorBusy(false);
    }
  }, []);

  return (
    <div className={cn("flex h-full flex-col bg-card text-card-foreground", className)}>
      <PanelHeader saveState={saveState} />
      <TabBar tab={tab} setTab={setTab} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "hints" && <HintsTab prefs={prefs} onChange={queueSave} />}
        {tab === "clis" && <CliTab prefs={prefs} onChange={queueSave} />}
        {tab === "schedules" && <SchedulesTab />}
        {tab === "doctor" && <DoctorTab doctor={doctor} busy={doctorBusy} onRefresh={refreshDoctor} />}
      </div>
    </div>
  );
}

function PanelHeader({ saveState }: { saveState: "idle" | "saving" | "saved" }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <span className="font-mono text-sm font-semibold text-accent">Agent Profile</span>
      <span className="flex-1" />
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-wide transition-opacity",
          saveState === "idle" ? "opacity-0" : "opacity-100",
          saveState === "saved" ? "text-emerald-400" : "text-muted-foreground"
        )}
      >
        {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : ""}
      </span>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "hints", label: "Hints" },
  { id: "clis", label: "CLIs" },
  { id: "schedules", label: "Schedules" },
  { id: "doctor", label: "Doctor" }
];

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }): React.ReactElement {
  return (
    <div className="flex border-b border-border bg-muted/30 px-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={cn(
            "relative px-3 py-2 font-mono text-xs uppercase tracking-wide transition-colors",
            tab === t.id ? "text-accent" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
          {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
        </button>
      ))}
    </div>
  );
}

function HintsTab({
  prefs,
  onChange
}: {
  prefs: AgentPrefs;
  onChange: (next: AgentPrefs) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Label>Routing hints</Label>
      <p className="text-xs text-muted-foreground">
        Free-form preferences for how the agent should pick between Claude Code and Codex. Injected verbatim into the routing
        agent&apos;s system prompt on every chat request.
      </p>
      <textarea
        value={prefs.routingHints}
        onChange={(e) => onChange({ ...prefs, routingHints: e.target.value })}
        placeholder={'e.g. "Prefer Codex for TypeScript edits; use Claude for design reviews and code-review passes."'}
        rows={10}
        className={inputCls("h-48 resize-none font-mono")}
      />
    </div>
  );
}

function CliTab({
  prefs,
  onChange
}: {
  prefs: AgentPrefs;
  onChange: (next: AgentPrefs) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionTitle>Behavior</SectionTitle>
        <Field label="Approval">
          <select
            value={prefs.approval}
            onChange={(e) =>
              onChange({ ...prefs, approval: e.target.value as AgentPrefs["approval"] })
            }
            className={inputCls()}
          >
            <option value="auto">auto — invoke tools immediately</option>
            <option value="ask">ask — preview every prompt before sending</option>
          </select>
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Claude Code</SectionTitle>
        <Field label="Model">
          <input
            value={prefs.claude.model ?? ""}
            onChange={(e) => onChange({ ...prefs, claude: { ...prefs.claude, model: e.target.value || undefined } })}
            placeholder="opus | sonnet | haiku | custom"
            className={inputCls()}
          />
        </Field>
        <Field label="Permission mode">
          <select
            value={prefs.claude.permissionMode ?? "bypassPermissions"}
            onChange={(e) =>
              onChange({
                ...prefs,
                claude: { ...prefs.claude, permissionMode: e.target.value as AgentPrefs["claude"]["permissionMode"] }
              })
            }
            className={inputCls()}
          >
            <option value="bypassPermissions">bypassPermissions (default)</option>
            <option value="plan">plan</option>
            <option value="ask">ask</option>
          </select>
        </Field>
        <Field label="Extra args">
          <input
            value={prefs.claude.extraArgs ?? ""}
            onChange={(e) => onChange({ ...prefs, claude: { ...prefs.claude, extraArgs: e.target.value || undefined } })}
            placeholder="--debug --max-tokens 8000"
            className={inputCls("font-mono")}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Codex</SectionTitle>
        <Field label="Model">
          <input
            value={prefs.codex.model ?? ""}
            onChange={(e) => onChange({ ...prefs, codex: { ...prefs.codex, model: e.target.value || undefined } })}
            placeholder="gpt-5 | gpt-5-mini | custom"
            className={inputCls()}
          />
        </Field>
        <Field label="Sandbox mode">
          <select
            value={prefs.codex.sandboxMode ?? "workspace-write"}
            onChange={(e) =>
              onChange({
                ...prefs,
                codex: { ...prefs.codex, sandboxMode: e.target.value as AgentPrefs["codex"]["sandboxMode"] }
              })
            }
            className={inputCls()}
          >
            <option value="workspace-write">workspace-write (default)</option>
            <option value="read-only">read-only</option>
          </select>
        </Field>
        <Field label="Extra args">
          <input
            value={prefs.codex.extraArgs ?? ""}
            onChange={(e) => onChange({ ...prefs, codex: { ...prefs.codex, extraArgs: e.target.value || undefined } })}
            placeholder="--ask-for-approval never"
            className={inputCls("font-mono")}
          />
        </Field>
      </section>
    </div>
  );
}

function SchedulesTab(): React.ReactElement {
  const { schedules, create, update, remove, runNow } = useSchedules();
  const [name, setName] = useState("");
  const [cron, setCron] = useState("*/5 * * * *");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    if (!name.trim() || !cron.trim() || !prompt.trim()) {
      setError("name, cron, and prompt are required");
      return;
    }
    setBusy(true);
    try {
      const created = await create({ name: name.trim(), cron: cron.trim(), prompt: prompt.trim() });
      if (!created) {
        setError("create failed — check the cron expression");
        return;
      }
      setName("");
      setPrompt("");
    } finally {
      setBusy(false);
    }
  }, [name, cron, prompt, create]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <SectionTitle>New schedule</SectionTitle>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nightly tests" className={inputCls()} />
        </Field>
        <Field label="Cron (5-field)">
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="*/5 * * * *" className={inputCls("font-mono")} />
        </Field>
        <Field label="Prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Use Codex to run npm test in the sandbox and report the result."
            className={inputCls("font-mono resize-none")}
          />
        </Field>
        {error ? <div className="font-mono text-xs text-red-400">{error}</div> : null}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="self-start rounded border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy ? "creating…" : "create schedule"}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>Existing schedules</SectionTitle>
        {schedules.length === 0 ? (
          <div className="font-mono text-xs italic text-muted-foreground">no schedules</div>
        ) : (
          schedules.map((s) => (
            <ScheduleRow key={s.id} schedule={s} onUpdate={update} onDelete={remove} onRunNow={runNow} />
          ))
        )}
      </section>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onUpdate,
  onDelete,
  onRunNow
}: {
  schedule: Schedule;
  onUpdate: (id: string, partial: Partial<Pick<Schedule, "name" | "cron" | "prompt" | "enabled">>) => Promise<Schedule | null>;
  onDelete: (id: string) => Promise<void>;
  onRunNow: (id: string) => Promise<void>;
}): React.ReactElement {
  const lastRun = schedule.runs[0];
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-background/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{schedule.name}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onUpdate(schedule.id, { enabled: !schedule.enabled })}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
            schedule.enabled ? "border-emerald-400/50 text-emerald-400" : "border-muted-foreground/40 text-muted-foreground"
          )}
        >
          {schedule.enabled ? "enabled" : "disabled"}
        </button>
        <button
          type="button"
          onClick={() => onRunNow(schedule.id)}
          className="flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted"
          aria-label="Run now"
        >
          <PlayIcon className="h-3 w-3" />
          run
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete schedule "${schedule.name}"?`)) onDelete(schedule.id);
          }}
          className="flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-red-400"
          aria-label="Delete schedule"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        cron: <code>{schedule.cron}</code>
        {lastRun ? ` · last: ${lastRun.status} (${new Date(lastRun.startedAt).toLocaleTimeString()})` : " · no runs yet"}
      </div>
    </div>
  );
}

function DoctorTab({
  doctor,
  busy,
  onRefresh
}: {
  doctor: DoctorReport | null;
  busy: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SectionTitle>CLI doctor</SectionTitle>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCwIcon className={cn("h-3 w-3", busy && "animate-spin")} />
          {busy ? "checking…" : "refresh"}
        </button>
      </div>
      {!doctor ? (
        <p className="font-mono text-xs text-muted-foreground">loading…</p>
      ) : (
        <>
          <StatusRow name="claude" status={doctor.claude} />
          <StatusRow name="codex" status={doctor.codex} />
          <p className="pt-2 font-mono text-[10px] text-muted-foreground">checked {new Date(doctor.checkedAt).toLocaleTimeString()}</p>
        </>
      )}
    </div>
  );
}

function StatusRow({ name, status }: { name: string; status: CliStatus }): React.ReactElement {
  const installed = status.installed;
  const auth = status.authenticated;
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-background/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{name}</span>
        <span className="flex-1" />
        <Pill tone={installed ? "good" : "bad"}>{installed ? "installed" : "missing"}</Pill>
        {installed && <Pill tone={auth ? "good" : "warn"}>{auth ? "authed" : "not authed"}</Pill>}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        {installed ? status.version ?? "version unknown" : status.error ?? "not found on PATH"}
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "good" | "warn" | "bad"; children: React.ReactNode }): React.ReactElement {
  const cls =
    tone === "good"
      ? "border-emerald-400/50 text-emerald-400"
      : tone === "warn"
        ? "border-amber-400/50 text-amber-400"
        : "border-red-400/50 text-red-400";
  return (
    <span className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide", cls)}>
      {tone === "good" && <CheckIcon className="h-2.5 w-2.5" />}
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">{children}</h3>;
}

function Label({ children }: { children: React.ReactNode }): React.ReactElement {
  return <label className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">{children}</label>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function inputCls(extra = ""): string {
  return cn(
    "w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
    extra
  );
}
