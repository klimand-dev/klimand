// Lightweight GitHub PR + issue ingest. Fetches a small metadata blob and a
// truncated diff/body suitable for injection into the orchestrator's system
// prompt.
//
// No GitHub SDK dependency — REST calls only. PAT (if present) raises the
// rate limit from 60 req/hr to 5000.

const GITHUB_API = "https://api.github.com";
const DIFF_BUDGET = 6000; // chars; the orchestrator prompt budget cares about size
const BODY_BUDGET = 1500;

export interface GitHubPRRef {
  kind: "pr";
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubIssueRef {
  kind: "issue";
  owner: string;
  repo: string;
  number: number;
}

export type GitHubRef = GitHubPRRef | GitHubIssueRef;

export interface IngestedPR {
  kind: "pr";
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  author: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  diffExcerpt: string;
  truncated: boolean;
}

export interface IngestedIssue {
  kind: "issue";
  url: string;
  title: string;
  body: string;
  state: "open" | "closed";
  author: string;
  labels: string[];
}

export type Ingested = IngestedPR | IngestedIssue;

export function parseGitHubUrl(input: string): GitHubRef | null {
  try {
    const url = new URL(input.trim());
    if (!/^github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, repo, kindWord, numberStr] = parts;
    const number = Number(numberStr);
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) return null;
    if (kindWord === "pull") return { kind: "pr", owner, repo, number };
    if (kindWord === "issues") return { kind: "issue", owner, repo, number };
    return null;
  } catch {
    return null;
  }
}

function authHeaders(pat?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
  if (pat) h.authorization = `Bearer ${pat}`;
  return h;
}

function clip(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function ingestGitHubPR(ref: GitHubPRRef, pat?: string): Promise<IngestedPR> {
  const base = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const [meta, diff] = await Promise.all([
    fetch(base, { headers: authHeaders(pat) }),
    fetch(base, { headers: { ...authHeaders(pat), accept: "application/vnd.github.v3.diff" } })
  ]);
  if (!meta.ok) throw new Error(`github pr fetch ${meta.status}`);
  const m = (await meta.json()) as {
    title: string;
    body: string | null;
    state: "open" | "closed";
    merged: boolean;
    user: { login: string };
    base: { ref: string };
    head: { ref: string };
    changed_files: number;
    additions: number;
    deletions: number;
    html_url: string;
  };
  let diffText = "";
  let truncated = false;
  if (diff.ok) {
    const raw = await diff.text();
    if (raw.length > DIFF_BUDGET) {
      diffText = `${raw.slice(0, DIFF_BUDGET)}\n…(diff truncated; ${raw.length - DIFF_BUDGET} more chars)`;
      truncated = true;
    } else {
      diffText = raw;
    }
  }
  return {
    kind: "pr",
    url: m.html_url,
    title: m.title,
    body: clip(m.body ?? "", BODY_BUDGET),
    state: m.merged ? "merged" : m.state,
    author: m.user?.login ?? "unknown",
    baseBranch: m.base?.ref ?? "",
    headBranch: m.head?.ref ?? "",
    changedFiles: m.changed_files ?? 0,
    additions: m.additions ?? 0,
    deletions: m.deletions ?? 0,
    diffExcerpt: diffText,
    truncated
  };
}

export async function ingestGitHubIssue(ref: GitHubIssueRef, pat?: string): Promise<IngestedIssue> {
  const url = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const res = await fetch(url, { headers: authHeaders(pat) });
  if (!res.ok) throw new Error(`github issue fetch ${res.status}`);
  const m = (await res.json()) as {
    title: string;
    body: string | null;
    state: "open" | "closed";
    user: { login: string };
    labels: Array<{ name: string }>;
    html_url: string;
  };
  return {
    kind: "issue",
    url: m.html_url,
    title: m.title,
    body: clip(m.body ?? "", BODY_BUDGET),
    state: m.state,
    author: m.user?.login ?? "unknown",
    labels: (m.labels ?? []).map((l) => l.name).filter(Boolean)
  };
}

export function summarizeForPrompt(i: Ingested): string {
  if (i.kind === "pr") {
    return [
      `GitHub PR: ${i.title} (${i.state})`,
      `URL: ${i.url}`,
      `Author: ${i.author} · ${i.headBranch} → ${i.baseBranch}`,
      `Changes: ${i.changedFiles} files, +${i.additions} / -${i.deletions}`,
      "",
      i.body ? `Description:\n${i.body}` : "",
      "",
      i.diffExcerpt ? `Diff${i.truncated ? " (truncated)" : ""}:\n\`\`\`diff\n${i.diffExcerpt}\n\`\`\`` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `GitHub Issue: ${i.title} (${i.state})`,
    `URL: ${i.url}`,
    `Author: ${i.author}${i.labels.length ? ` · labels: ${i.labels.join(", ")}` : ""}`,
    "",
    i.body ? `Body:\n${i.body}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
