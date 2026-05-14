"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCwIcon,
  FolderOpenIcon,
  FileTextIcon,
  CopyIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  AlertTriangleIcon
} from "lucide-react";
import type { ProjectProfile } from "@/lib/project-profile";
import type { Thread } from "@/lib/threads";
import { cn } from "@/lib/utils";

export interface ProjectViewProps {
  path: string;
  threadsInProject: Thread[];
  onSelectThread: (id: string) => void;
}

interface ProfileResponse {
  profile: ProjectProfile;
  digest: string;
  ms: number;
  digestBytes: number;
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

export function ProjectView({ path, threadsInProject, onSelectThread }: ProjectViewProps): React.ReactElement {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      const url = `/api/projects/profile?path=${encodeURIComponent(path)}${refresh ? "&refresh=1" : ""}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as ErrorResponse;
          setError(err.message || err.error || `error ${res.status}`);
          setData(null);
          return;
        }
        const json = (await res.json()) as ProfileResponse;
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [path]
  );

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    load(false);
  }, [load]);

  const refresh = () => {
    setBusy(true);
    load(true);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
        loading project…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <AlertTriangleIcon className="h-5 w-5 text-red-400" />
        <div className="font-mono text-sm text-red-300">{error ?? "no data"}</div>
        <button
          type="button"
          onClick={refresh}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground hover:bg-muted"
        >
          retry
        </button>
      </div>
    );
  }

  const { profile, digest, digestBytes, ms } = data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header path={path} profile={profile} digestBytes={digestBytes} ms={ms} busy={busy} onRefresh={refresh} />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <ClaudeSection profile={profile} projectPath={path} />
          <CodexSection profile={profile} projectPath={path} />
          <SharedSection profile={profile} projectPath={path} />
          <ThreadsSection threads={threadsInProject} onSelect={onSelectThread} />
          {profile.warnings.length > 0 ? <WarningsSection warnings={profile.warnings} /> : null}
          <RawDigestSection digest={digest} digestBytes={digestBytes} />
        </div>
      </div>
    </div>
  );
}

function Header({
  path,
  profile,
  digestBytes,
  ms,
  busy,
  onRefresh
}: {
  path: string;
  profile: ProjectProfile;
  digestBytes: number;
  ms: number;
  busy: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">project</div>
          <div className="truncate font-mono text-sm font-semibold" title={path}>
            {path}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            scanned {new Date(profile.scannedAt).toLocaleString()} · fingerprint {profile.fingerprint} · digest {digestBytes} B · {ms} ms
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCwIcon className={cn("h-3 w-3", busy && "animate-spin")} />
          {busy ? "scanning…" : "refresh"}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2 border-b border-border pb-1">
      <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">{children}</span>
      {count !== undefined ? <span className="font-mono text-[10px] text-muted-foreground">({count})</span> : null}
    </div>
  );
}

function ArtifactRow({
  label,
  meta,
  body,
  projectPath,
  filePath
}: {
  label: string;
  meta?: string;
  body?: React.ReactNode;
  projectPath: string;
  filePath: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border bg-background/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => body && setOpen((v) => !v)}
          disabled={!body}
          className={cn(
            "flex flex-1 items-center gap-1.5 truncate text-left font-mono text-xs",
            body ? "hover:text-foreground" : "cursor-default"
          )}
        >
          {body ? (
            open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
          <span className="font-semibold">{label}</span>
          {meta ? <span className="text-muted-foreground">{meta}</span> : null}
        </button>
        <FileActions projectPath={projectPath} filePath={filePath} />
      </div>
      {open && body ? <div className="border-t border-border bg-background/30 px-3 py-2">{body}</div> : null}
    </div>
  );
}

function FileActions({ projectPath, filePath }: { projectPath: string; filePath: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const reveal = async (mode: "open" | "folder" | "copy") => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "copy") {
        try {
          await navigator.clipboard.writeText(filePath);
        } catch {
          /* clipboard blocked */
        }
        return;
      }
      await fetch("/api/projects/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath, path: filePath, mode })
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => reveal("open")}
        disabled={busy}
        className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Open file in default app"
      >
        <FileTextIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => reveal("folder")}
        disabled={busy}
        className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Show in folder"
      >
        <FolderOpenIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => reveal("copy")}
        disabled={busy}
        className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Copy path"
      >
        <CopyIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const r = root.replace(/[\\/]+$/, "");
  const tail = rel.replace(/^[\\/]+/, "");
  return `${r}${sep}${tail.replace(/[\\/]/g, sep)}`;
}

function Excerpt({ text }: { text: string }): React.ReactElement {
  return (
    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-foreground">
      {text}
    </pre>
  );
}

function ClaudeSection({ profile, projectPath }: { profile: ProjectProfile; projectPath: string }): React.ReactElement {
  const claudeMd = profile.claudeMd;
  const claudeMdMeta = claudeMd ? `${(claudeMd.bytes / 1024).toFixed(1)} KB${claudeMd.truncated ? " · head excerpt" : ""}` : "—";
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Claude Code</SectionTitle>
      <ArtifactRow
        label="CLAUDE.md"
        meta={claudeMdMeta}
        body={claudeMd ? <Excerpt text={claudeMd.excerpt} /> : undefined}
        projectPath={projectPath}
        filePath={joinPath(projectPath, "CLAUDE.md")}
      />
      <ListBlock
        label="Slash commands"
        emptyLabel="No commands"
        items={profile.commands.map((c) => ({ name: c.name, description: c.description, filePath: joinPath(projectPath, `.claude/commands/${c.name}.md`) }))}
        projectPath={projectPath}
      />
      <ListBlock
        label="Subagents"
        emptyLabel="No subagents"
        items={profile.agents.map((a) => ({ name: a.name, description: a.description, filePath: joinPath(projectPath, `.claude/agents/${a.name}.md`) }))}
        projectPath={projectPath}
      />
      <ListBlock
        label="Skills"
        emptyLabel="No skills"
        items={profile.skills.map((s) => ({ name: s.name, description: s.description, filePath: joinPath(projectPath, `.claude/skills/${s.name}/SKILL.md`) }))}
        projectPath={projectPath}
      />
      <HooksBlock hooks={profile.hooks} projectPath={projectPath} />
    </section>
  );
}

function CodexSection({ profile, projectPath }: { profile: ProjectProfile; projectPath: string }): React.ReactElement {
  const agentsMd = profile.agentsMd;
  const agentsMdMeta = agentsMd ? `${(agentsMd.bytes / 1024).toFixed(1)} KB${agentsMd.truncated ? " · head excerpt" : ""}` : "—";
  const codexConfig = profile.codexConfig;
  const codexMeta = codexConfig ? `${codexConfig.bytes} B${codexConfig.truncated ? " · truncated" : ""}` : "—";
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Codex</SectionTitle>
      <ArtifactRow
        label="AGENTS.md"
        meta={agentsMdMeta}
        body={agentsMd ? <Excerpt text={agentsMd.excerpt} /> : undefined}
        projectPath={projectPath}
        filePath={joinPath(projectPath, "AGENTS.md")}
      />
      <ArtifactRow
        label=".codex/config.toml"
        meta={codexMeta}
        body={codexConfig ? <Excerpt text={codexConfig.excerpt} /> : undefined}
        projectPath={projectPath}
        filePath={joinPath(projectPath, ".codex/config.toml")}
      />
    </section>
  );
}

function SharedSection({ profile, projectPath }: { profile: ProjectProfile; projectPath: string }): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Shared (MCP)</SectionTitle>
      {profile.mcpServers.length === 0 ? (
        <div className="rounded border border-border bg-background/40 px-3 py-2 font-mono text-xs italic text-muted-foreground">
          No MCP servers configured
        </div>
      ) : (
        <div className="rounded border border-border bg-background/40">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="font-mono text-xs font-semibold">.mcp.json ({profile.mcpServers.length} servers)</span>
            <FileActions projectPath={projectPath} filePath={joinPath(projectPath, ".mcp.json")} />
          </div>
          <div className="border-t border-border px-3 py-2">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {profile.mcpServers.map((s) => (
                <li key={s.name} className="flex items-baseline gap-2">
                  <span className="font-semibold text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">{s.transport}</span>
                  {s.commandHint ? <span className="truncate text-muted-foreground">· {s.commandHint}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function ListBlock({
  label,
  emptyLabel,
  items,
  projectPath
}: {
  label: string;
  emptyLabel: string;
  items: Array<{ name: string; description: string; filePath: string }>;
  projectPath: string;
}): React.ReactElement {
  return (
    <div className="rounded border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 font-mono text-xs font-semibold">
          {label} <span className="text-muted-foreground">({items.length})</span>
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-2 font-mono text-[11px] italic text-muted-foreground">{emptyLabel}</div>
      ) : (
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.name} className="flex items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0">
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                <span className="truncate font-mono text-xs font-semibold text-foreground">{it.name}</span>
                {it.description ? (
                  <span className="truncate font-mono text-[10px] text-muted-foreground" title={it.description}>
                    {it.description}
                  </span>
                ) : null}
              </div>
              <FileActions projectPath={projectPath} filePath={it.filePath} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HooksBlock({
  hooks,
  projectPath
}: {
  hooks: ProjectProfile["hooks"];
  projectPath: string;
}): React.ReactElement {
  const byEvent = new Map<string, number>();
  for (const h of hooks) byEvent.set(h.event, (byEvent.get(h.event) ?? 0) + h.count);
  return (
    <div className="rounded border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 font-mono text-xs font-semibold">Hooks</span>
        <FileActions projectPath={projectPath} filePath={joinPath(projectPath, ".claude/settings.json")} />
      </div>
      <div className="px-3 py-2 font-mono text-[11px]">
        {byEvent.size === 0 ? (
          <span className="italic text-muted-foreground">No hooks configured</span>
        ) : (
          <span className="text-foreground">{[...byEvent.entries()].map(([e, n]) => `${e}×${n}`).join(", ")}</span>
        )}
      </div>
    </div>
  );
}

function ThreadsSection({
  threads,
  onSelect
}: {
  threads: Thread[];
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle count={threads.length}>Threads in this project</SectionTitle>
      {threads.length === 0 ? (
        <div className="font-mono text-xs italic text-muted-foreground">No threads scoped to this project yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                className="flex w-full items-center gap-2 rounded border border-border bg-background/40 px-3 py-2 text-left hover:bg-muted/40"
              >
                <span className="flex-1 truncate font-mono text-xs font-semibold text-foreground">{t.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(t.lastTouched).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WarningsSection({ warnings }: { warnings: string[] }): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle count={warnings.length}>Warnings</SectionTitle>
      <ul className="flex flex-col gap-1 rounded border border-amber-700/50 bg-amber-900/10 p-3">
        {warnings.map((w, i) => (
          <li key={i} className="flex items-start gap-2 font-mono text-[11px] text-amber-200">
            <AlertTriangleIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
            {w}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RawDigestSection({ digest, digestBytes }: { digest: string; digestBytes: number }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-baseline gap-2 border-b border-border pb-1 text-left">
        {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">Raw digest</span>
        <span className="font-mono text-[10px] text-muted-foreground">({digestBytes} B — what the orchestrator sees)</span>
      </button>
      {open ? (
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-3 font-mono text-[11px] text-foreground">
          {digest}
        </pre>
      ) : null}
    </section>
  );
}
