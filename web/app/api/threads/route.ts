import { NextResponse } from "next/server";
import { listThreads, createThread, ThreadKindSchema } from "@/lib/threads";
import { ensureScheduler } from "@/lib/scheduler-init";
import { getPrefs } from "@/lib/prefs";
import {
  parseGitHubUrl,
  ingestGitHubPR,
  ingestGitHubIssue,
  summarizeForPrompt
} from "@/lib/ingest-github";
import {
  parseLinearUrl,
  ingestLinearIssue,
  summarizeLinearForPrompt
} from "@/lib/ingest-linear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  ensureScheduler().catch(() => {});
  const threads = await listThreads();
  return NextResponse.json({ threads });
}

interface PostBody {
  title?: string;
  kind?: string;
  scheduleId?: string;
  ingestUrl?: string;
  projectPath?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    /* empty body is fine — create a default chat thread */
  }
  const parsedKind = body.kind ? ThreadKindSchema.safeParse(body.kind) : undefined;
  const kind = parsedKind && parsedKind.success ? parsedKind.data : "chat";
  let title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim() : undefined;
  const scheduleId = typeof body.scheduleId === "string" ? body.scheduleId : undefined;
  const projectPath = typeof body.projectPath === "string" ? body.projectPath : undefined;

  let context: string | undefined;
  if (body.ingestUrl && typeof body.ingestUrl === "string") {
    try {
      const prefs = await getPrefs();
      const ghRef = parseGitHubUrl(body.ingestUrl);
      if (ghRef) {
        const ingested = ghRef.kind === "pr"
          ? await ingestGitHubPR(ghRef, prefs.integrations.github.pat)
          : await ingestGitHubIssue(ghRef, prefs.integrations.github.pat);
        context = summarizeForPrompt(ingested);
        if (!title) {
          title = ingested.kind === "pr"
            ? `PR #${ghRef.number}: ${ingested.title}`
            : `Issue #${ghRef.number}: ${ingested.title}`;
        }
      } else {
        const lRef = parseLinearUrl(body.ingestUrl);
        if (lRef) {
          const apiKey = prefs.integrations.linear.apiKey;
          if (!apiKey) {
            return NextResponse.json(
              { error: "linear_key_missing", message: "Paste a Linear API key in Settings → BYOK first." },
              { status: 400 }
            );
          }
          const ingested = await ingestLinearIssue(lRef, apiKey);
          context = summarizeLinearForPrompt(ingested);
          if (!title) title = `${ingested.identifier}: ${ingested.title}`;
        } else {
          return NextResponse.json(
            { error: "url_not_recognized", message: "URL doesn't look like a GitHub PR/issue or Linear issue." },
            { status: 400 }
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: "ingest_failed", message: msg }, { status: 502 });
    }
  }

  const thread = await createThread({ title, kind, scheduleId, context, projectPath });
  return NextResponse.json({ thread }, { status: 201 });
}
