import { getGoal } from "@/lib/goals";
import { subscribe } from "@/lib/event-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of events for a goal. Pushes:
 *   - one `goal.snapshot` event on connect (current Goal JSON)
 *   - subsequent events as they are published on channel `goal:<id>`
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const goal = await getGoal(id);
  if (!goal) return new Response("not_found", { status: 404 });

  const url = new URL(req.url);
  const lastTs = url.searchParams.get("lastTs") ?? undefined;

  const channelId = `goal:${id}`;
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* controller closed; ignore */
        }
      };

      send({ kind: "goal.snapshot", goal });

      const sub = await subscribe(
        channelId,
        (event) => send(event),
        lastTs ? { replayFromTs: lastTs } : {}
      );
      cleanup = sub;

      heartbeatHandle = setInterval(() => send({ kind: "heartbeat", ts: new Date().toISOString() }), 15_000);

      req.signal.addEventListener("abort", () => {
        if (cleanup) cleanup();
        if (heartbeatHandle) clearInterval(heartbeatHandle);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (cleanup) cleanup();
      if (heartbeatHandle) clearInterval(heartbeatHandle);
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
