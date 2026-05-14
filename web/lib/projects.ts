import type { Thread } from "./threads";

export interface ApprovedRef {
  path: string;
  label: string;
  lastUsed: string;
}

export interface ProjectGroup {
  path: string;
  label: string;
  threads: Thread[];
  lastTouched: string;
}

export interface ThreadGrouping {
  projects: ProjectGroup[];
  unassigned: Thread[];
  scheduled: Thread[];
}

function basename(p: string): string {
  // Cheap cross-platform basename — works for both Win and POSIX inputs at runtime.
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function deriveProjects(threads: Thread[], approved: ApprovedRef[] = []): ThreadGrouping {
  const byProject = new Map<string, Thread[]>();
  const labels = new Map<string, string>();
  const lastTouchedByPath = new Map<string, string>();
  const unassigned: Thread[] = [];
  const scheduled: Thread[] = [];

  for (const a of approved) {
    labels.set(a.path, a.label);
    lastTouchedByPath.set(a.path, a.lastUsed);
    if (!byProject.has(a.path)) byProject.set(a.path, []);
  }

  for (const t of threads) {
    if (t.kind === "scheduled") {
      scheduled.push(t);
      continue;
    }
    if (t.projectPath) {
      const list = byProject.get(t.projectPath) ?? [];
      list.push(t);
      byProject.set(t.projectPath, list);
    } else {
      unassigned.push(t);
    }
  }

  const projects: ProjectGroup[] = [];
  for (const [p, ts] of byProject.entries()) {
    ts.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
    const threadLatest = ts[0]?.lastTouched ?? "";
    const approvedLatest = lastTouchedByPath.get(p) ?? "";
    const lastTouched = threadLatest.localeCompare(approvedLatest) >= 0 ? threadLatest : approvedLatest;
    projects.push({
      path: p,
      label: labels.get(p) ?? basename(p) ?? p,
      threads: ts,
      lastTouched
    });
  }
  projects.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
  unassigned.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
  scheduled.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
  return { projects, unassigned, scheduled };
}

export const projectBasename = basename;
