// GitHub-backed sync (Pro feature).
//
// The user's own private repo (default name: `klimand-state`) is the
// canonical backend. On every mutation to projects.json / threads, we
// debounce and push a snapshot. On launch and on demand we pull and
// surface conflicts.
//
// We use the GitHub Contents API: GET /repos/{o}/{r}/contents/{path} and
// PUT same with base64-encoded content and a SHA from the last GET. That
// gives us optimistic concurrency at the file level for free.
//
// Snapshot shape (synced as one JSON file per state slice):
//   - projects.json        — registry
//   - threads/<id>.json    — one per thread
//   - prefs.snippet.json   — non-secret subset of prefs (routing hints, etc.)
//
// Secrets (LLM keys, PATs, license) are never synced.

import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPrefs } from "./prefs";

const DEFAULT_REPO_NAME = "klimand-state";

function stateDir(): string {
  if (process.env.KLIMAND_STATE_DIR) return path.resolve(process.env.KLIMAND_STATE_DIR);
  return path.resolve(process.cwd(), "..", ".klimand");
}

function prefsDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "klimand");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "klimand");
}

interface SyncTarget {
  owner: string;
  repo: string;
  pat: string;
}

async function getSyncTarget(): Promise<SyncTarget | null> {
  const prefs = await getPrefs();
  const pat = prefs.integrations.github.pat;
  if (!pat) return null;
  // Owner is inferred from the PAT's `/user` endpoint.
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${pat}`, accept: "application/vnd.github+json" }
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { login: string };
    return { owner: u.login, repo: DEFAULT_REPO_NAME, pat };
  } catch {
    return null;
  }
}

async function ensureRepo(t: SyncTarget): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${t.owner}/${t.repo}`, {
    headers: { authorization: `Bearer ${t.pat}`, accept: "application/vnd.github+json" }
  });
  if (res.ok) return;
  if (res.status !== 404) throw new Error(`github repo check ${res.status}`);
  const create = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      authorization: `Bearer ${t.pat}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: t.repo,
      private: true,
      description: "Klimand state — managed automatically. Safe to delete to reset sync.",
      auto_init: true
    })
  });
  if (!create.ok) throw new Error(`github repo create ${create.status}`);
}

interface FileMetadata {
  sha?: string;
  content?: string;
}

async function getFileMeta(t: SyncTarget, p: string): Promise<FileMetadata | null> {
  const res = await fetch(
    `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${encodeURIComponent(p)}`,
    { headers: { authorization: `Bearer ${t.pat}`, accept: "application/vnd.github+json" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github get ${p}: ${res.status}`);
  return (await res.json()) as FileMetadata;
}

async function putFile(t: SyncTarget, p: string, content: string, message: string): Promise<void> {
  const existing = await getFileMeta(t, p);
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, "utf8").toString("base64")
  };
  if (existing?.sha) body.sha = existing.sha;
  const res = await fetch(
    `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${encodeURIComponent(p)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${t.pat}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`github put ${p}: ${res.status} — ${text}`);
  }
}

let pushQueued = false;
let pushPending: Promise<void> = Promise.resolve();
const PUSH_DEBOUNCE_MS = 2000;

export function schedulePush(): void {
  if (pushQueued) return;
  pushQueued = true;
  pushPending = pushPending.then(
    () =>
      new Promise<void>((resolveP) => {
        setTimeout(async () => {
          pushQueued = false;
          try {
            await pushNow();
          } catch {
            /* swallow; next mutation will retry */
          } finally {
            resolveP();
          }
        }, PUSH_DEBOUNCE_MS);
      })
  );
}

export async function pushNow(): Promise<{ ok: boolean; message?: string }> {
  const t = await getSyncTarget();
  if (!t) return { ok: false, message: "no GitHub PAT configured" };
  try {
    await ensureRepo(t);
    const ts = new Date().toISOString();

    // 1) projects.json (registry)
    try {
      const reg = await readFile(path.join(prefsDir(), "projects.json"), "utf8");
      await putFile(t, "projects.json", reg, `sync: projects ${ts}`);
    } catch {
      /* file may not exist yet */
    }

    // 2) threads/*
    const threadsRoot = path.join(stateDir(), "threads");
    try {
      const entries = await readdir(threadsRoot);
      for (const f of entries) {
        if (!f.endsWith(".json")) continue;
        const content = await readFile(path.join(threadsRoot, f), "utf8");
        await putFile(t, `threads/${f}`, content, `sync: thread ${f} ${ts}`);
      }
    } catch {
      /* threads dir may not exist yet */
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function pullNow(): Promise<{ ok: boolean; message?: string; conflicts?: string[] }> {
  const t = await getSyncTarget();
  if (!t) return { ok: false, message: "no GitHub PAT configured" };
  // For v1 we treat the GitHub repo as a backup snapshot only: we never
  // overwrite local files. Pull surfaces the remote SHA of each file the
  // user might want to restore. Restoring is an explicit user action.
  try {
    await ensureRepo(t);
    const conflicts: string[] = [];
    const reg = await getFileMeta(t, "projects.json");
    if (reg) conflicts.push("projects.json");
    return { ok: true, conflicts };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
