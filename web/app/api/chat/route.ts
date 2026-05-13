import { createUIMessageStreamResponse } from "ai";
import { runAgentAsUIStream } from "@/lib/bridge";
import { getOrCreateDefaultThread, getThread } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

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
