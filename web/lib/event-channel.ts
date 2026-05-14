import type { SessionEvent } from "./session-log";
import { appendEvent, readEventsSince } from "./session-log";

/**
 * In-memory pub/sub keyed by channel id. Channel ids are typically session ids
 * or goal ids ("goal:<id>"). Persistence is delegated to session-log; this
 * module only handles live fan-out to currently-attached subscribers.
 *
 * Survival semantics:
 *   - Publish writes to the persistent log first, then notifies live subscribers.
 *   - On process restart, in-memory channels are empty. Subscribers re-attach
 *     and replay missed events via readEventsSince().
 */

type Listener = (event: SessionEvent) => void;

interface Channel {
  listeners: Set<Listener>;
}

const G = globalThis as unknown as { __klimandEventChannels?: Map<string, Channel> };
function channels(): Map<string, Channel> {
  if (!G.__klimandEventChannels) G.__klimandEventChannels = new Map();
  return G.__klimandEventChannels;
}

function getOrCreate(channelId: string): Channel {
  let c = channels().get(channelId);
  if (!c) {
    c = { listeners: new Set() };
    channels().set(channelId, c);
  }
  return c;
}

/**
 * Publish an event to a channel. For session channels, the event is also
 * appended to the session's events.jsonl. For goal channels (id prefix "goal:"),
 * persistence happens elsewhere — the channel is informational fan-out.
 */
export async function publish(channelId: string, event: Omit<SessionEvent, "ts"> & { ts?: string }): Promise<SessionEvent> {
  const persisted = channelId.startsWith("goal:")
    ? { ts: event.ts ?? new Date().toISOString(), kind: event.kind, ...(event.data !== undefined ? { data: event.data } : {}) }
    : await appendEvent(channelId, event);
  const c = channels().get(channelId);
  if (c) {
    for (const l of c.listeners) {
      try {
        l(persisted);
      } catch {
        /* one bad listener should not block others */
      }
    }
  }
  return persisted;
}

/**
 * Subscribe to a channel. Returns an unsubscribe function.
 *
 * If `replayFromTs` is provided AND the channel id is a session id, missed
 * events are replayed before the live stream starts.
 */
export interface SubscribeOptions {
  replayFromTs?: string;
}

export async function subscribe(channelId: string, listener: Listener, opts: SubscribeOptions = {}): Promise<() => void> {
  const c = getOrCreate(channelId);
  c.listeners.add(listener);

  if (opts.replayFromTs && !channelId.startsWith("goal:")) {
    const replay = await readEventsSince(channelId, opts.replayFromTs);
    for (const ev of replay) listener(ev);
  }

  return () => {
    const cur = channels().get(channelId);
    if (cur) {
      cur.listeners.delete(listener);
      if (cur.listeners.size === 0) channels().delete(channelId);
    }
  };
}

/**
 * Test helper: count listeners on a channel.
 */
export function listenerCount(channelId: string): number {
  return channels().get(channelId)?.listeners.size ?? 0;
}

/**
 * Test helper: clear all channels.
 */
export function _clearAllChannels(): void {
  channels().clear();
}
