// Linear issue ingest via GraphQL. Requires a personal API key (from
// Linear Settings → API → Personal API keys) stored in prefs.integrations.linear.apiKey.

const LINEAR_API = "https://api.linear.app/graphql";
const BODY_BUDGET = 2000;

export interface LinearIssueRef {
  team: string; // e.g. "ENG"
  number: number; // e.g. 123
  identifier: string; // "ENG-123"
}

export interface IngestedLinearIssue {
  kind: "linear";
  url: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  priority: number;
  assignee: string | null;
  labels: string[];
}

export function parseLinearUrl(input: string): LinearIssueRef | null {
  try {
    const trimmed = input.trim();
    // Two common shapes:
    //  - https://linear.app/<workspace>/issue/<team>-<number>/...
    //  - <team>-<number> bare identifier
    const bare = trimmed.match(/^([A-Z][A-Z0-9]+)-(\d+)$/);
    if (bare) return { team: bare[1], number: Number(bare[2]), identifier: `${bare[1]}-${bare[2]}` };
    const url = new URL(trimmed);
    if (!/^linear\.app$/i.test(url.hostname)) return null;
    const m = url.pathname.match(/\/issue\/([A-Z][A-Z0-9]+)-(\d+)/i);
    if (!m) return null;
    const team = m[1].toUpperCase();
    const number = Number(m[2]);
    return { team, number, identifier: `${team}-${number}` };
  } catch {
    return null;
  }
}

function clip(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

interface LinearResponse {
  data?: {
    issue?: {
      url: string;
      identifier: string;
      title: string;
      description: string | null;
      priority: number;
      state: { name: string } | null;
      assignee: { name: string } | null;
      labels: { nodes: Array<{ name: string }> };
    };
  };
  errors?: Array<{ message: string }>;
}

export async function ingestLinearIssue(ref: LinearIssueRef, apiKey: string): Promise<IngestedLinearIssue> {
  if (!apiKey) throw new Error("Linear API key not configured");
  const query = `query($id: String!) {
    issue(id: $id) {
      url
      identifier
      title
      description
      priority
      state { name }
      assignee { name }
      labels { nodes { name } }
    }
  }`;
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: ref.identifier } })
  });
  if (!res.ok) throw new Error(`linear api ${res.status}`);
  const data = (await res.json()) as LinearResponse;
  if (data.errors?.length) throw new Error(`linear: ${data.errors[0].message}`);
  const i = data.data?.issue;
  if (!i) throw new Error(`linear: issue ${ref.identifier} not found`);
  return {
    kind: "linear",
    url: i.url,
    identifier: i.identifier,
    title: i.title,
    description: clip(i.description ?? "", BODY_BUDGET),
    state: i.state?.name ?? "unknown",
    priority: i.priority ?? 0,
    assignee: i.assignee?.name ?? null,
    labels: (i.labels?.nodes ?? []).map((l) => l.name).filter(Boolean)
  };
}

export function summarizeLinearForPrompt(i: IngestedLinearIssue): string {
  return [
    `Linear Issue: ${i.identifier} — ${i.title}`,
    `URL: ${i.url}`,
    `State: ${i.state}${i.assignee ? ` · Assignee: ${i.assignee}` : ""}${i.labels.length ? ` · Labels: ${i.labels.join(", ")}` : ""}`,
    "",
    i.description ? `Description:\n${i.description}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
