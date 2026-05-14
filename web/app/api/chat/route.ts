import { createUIMessageStreamResponse } from "ai";
import { runAgentAsUIStream } from "@/lib/bridge";
import { getOrCreateDefaultThread, getThread } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give the post-tool model turn ~60s of headroom over the CLI timeout so a
// 29:59 CLI run still leaves budget for the orchestrator's closing reply.
// Hosted platforms (Vercel etc.) cap to plan limits regardless; this applies
// as written on `next dev` and self-hosted Node.
const CLI_TIMEOUT_MS_RAW = Number.parseInt(process.env.KLIMAND_CLI_TIMEOUT_MS ?? "", 10);
const CLI_TIMEOUT_SEC =
  Number.isFinite(CLI_TIMEOUT_MS_RAW) && CLI_TIMEOUT_MS_RAW > 0
    ? Math.floor(CLI_TIMEOUT_MS_RAW / 1000)
    : 1800;
export const maxDuration = CLI_TIMEOUT_SEC + 60;

export async function POST(req: Request): Promise<Response> {
  let messages: unknown[] = [];
  let bodyThreadId: string | undefined;
  try {
    const body = await req.json();
    if (body && Array.isArray(body.messages)) messages = body.messages;
    if (body && typeof body.threadId === "string") bodyThreadId = body.threadId;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const url = new URL(req.url);
  const queryThreadId = url.searchParams.get("threadId") ?? undefined;
  const requestedId = bodyThreadId ?? queryThreadId;

  let threadId: string;
  if (requestedId) {
    const found = await getThread(requestedId);
    threadId = found ? found.id : (await getOrCreateDefaultThread()).id;
  } else {
    threadId = (await getOrCreateDefaultThread()).id;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = runAgentAsUIStream(messages as any, { threadId });
  return createUIMessageStreamResponse({ stream });
}
