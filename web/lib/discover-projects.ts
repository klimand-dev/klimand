import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProjectMarkers, hasProjectMarker, isBlockedPath } from "./project-profile";

export interface ProjectCandidate {
  path: string;
  label: string;
  parentDir: string;
  markers: string[];
}

export interface DiscoveryResult {
  candidates: ProjectCandidate[];
  scannedAt: string;
  roots: string[];
  durationMs: number;
  truncated: boolean;
}

const MAX_CANDIDATES = 500;
const MAX_READDIR_ENTRIES = 5000;
const SCAN_TIMEOUT_MS = 5000;
const MAX_DEPTH = 2;

const SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
  "dist",
  "build",
  "out",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode"
]);

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

async function existsDir(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function nonProjectAncestor(start: string): Promise<string> {
  let cur = path.resolve(start);
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
    if (!(await hasProjectMarker(cur))) return cur;
  }
  return cur;
}

async function defaultSearchRoots(): Promise<string[]> {
  const home = os.homedir();
  const cwdAncestor = await nonProjectAncestor(process.cwd());
  const candidates = [
    home,
    path.join(home, "Documents"),
    path.join(home, "projects"),
    path.join(home, "code"),
    path.join(home, "dev"),
    path.join(home, "src"),
    path.join(home, "repos"),
    cwdAncestor
  ];
  return Array.from(new Set(candidates));
}

interface ScanState {
  candidates: ProjectCandidate[];
  readdirCount: number;
  deadline: number;
  seen: Set<string>;
  truncated: boolean;
}

function expired(state: ScanState): boolean {
  return Date.now() > state.deadline;
}

function capReached(state: ScanState): boolean {
  return state.candidates.length >= MAX_CANDIDATES || state.readdirCount >= MAX_READDIR_ENTRIES;
}

async function visit(dir: string, depth: number, state: ScanState): Promise<void> {
  if (expired(state) || capReached(state)) {
    state.truncated = true;
    return;
  }
  const abs = path.resolve(dir);
  if (state.seen.has(abs)) return;
  state.seen.add(abs);

  if (isBlockedPath(abs)) return;

  // Search roots themselves (depth 0) are scan starting points, not candidates —
  // descend through them even if they happen to have markers (e.g. ~/CLAUDE.md).
  if (depth > 0) {
    const markers = await detectProjectMarkers(abs);
    if (markers.length > 0) {
      state.candidates.push({
        path: abs,
        label: basename(abs) || abs,
        parentDir: path.dirname(abs),
        markers
      });
      return;
    }
  }

  if (depth >= MAX_DEPTH) return;

  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    return;
  }
  state.readdirCount += entries.length;
  if (capReached(state)) {
    state.truncated = true;
    return;
  }

  for (const name of entries) {
    if (expired(state) || capReached(state)) {
      state.truncated = true;
      return;
    }
    if (SKIP_NAMES.has(name)) continue;
    // Skip dot-dirs as candidates (we don't want ~/.config etc. surfaced)
    if (name.startsWith(".")) continue;
    const child = path.join(abs, name);
    let st;
    try {
      st = await stat(child);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    await visit(child, depth + 1, state);
  }
}

export async function discoverProjects(opts?: { roots?: string[] }): Promise<DiscoveryResult> {
  const started = Date.now();
  const rootsRaw = opts?.roots ?? (await defaultSearchRoots());
  const roots: string[] = [];
  for (const r of rootsRaw) {
    if (await existsDir(r)) roots.push(path.resolve(r));
  }
  const state: ScanState = {
    candidates: [],
    readdirCount: 0,
    deadline: started + SCAN_TIMEOUT_MS,
    seen: new Set(),
    truncated: false
  };
  for (const root of roots) {
    if (expired(state) || capReached(state)) {
      state.truncated = true;
      break;
    }
    await visit(root, 0, state);
  }
  // Sort: by basename, case-insensitive. Stable, predictable, no time component.
  state.candidates.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  return {
    candidates: state.candidates,
    scannedAt: new Date(started).toISOString(),
    roots,
    durationMs: Date.now() - started,
    truncated: state.truncated
  };
}

// 60s cache pinned on globalThis so HMR-created duplicates share results.
interface DiscoveryGlobal {
  __klimand_discover_cache?: { at: number; result: DiscoveryResult };
}
const g = globalThis as unknown as DiscoveryGlobal;
const CACHE_TTL_MS = 60_000;

export async function discoverProjectsCached(refresh?: boolean): Promise<DiscoveryResult> {
  const cached = g.__klimand_discover_cache;
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }
  const result = await discoverProjects();
  g.__klimand_discover_cache = { at: Date.now(), result };
  return result;
}
