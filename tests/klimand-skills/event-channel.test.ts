import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import {
  _clearAllChannels,
  listenerCount,
  publish,
  subscribe
} from "../../web/lib/event-channel.js";
import { newSessionId, appendEvent } from "../../web/lib/session-log.js";
import type { SessionEvent } from "../../web/lib/session-log.js";

let prev: string | undefined;

beforeEach(async () => {
  prev = process.env.KLIMAND_STATE_DIR;
  process.env.KLIMAND_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "klimand-channel-"));
  _clearAllChannels();
});

afterEach(() => {
  if (prev === undefined) delete process.env.KLIMAND_STATE_DIR;
  else process.env.KLIMAND_STATE_DIR = prev;
  _clearAllChannels();
});

describe("event-channel", () => {
  test("subscribe receives published events", async () => {
    const id = newSessionId();
    const received: SessionEvent[] = [];
    await subscribe(id, (ev) => received.push(ev));
    await publish(id, { kind: "session.started" });
    await publish(id, { kind: "session.exit", data: { exitCode: 0 } });
    expect(received.map((e) => e.kind)).toEqual(["session.started", "session.exit"]);
  });

  test("multiple subscribers each receive every event", async () => {
    const id = newSessionId();
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    await subscribe(id, (ev) => a.push(ev));
    await subscribe(id, (ev) => b.push(ev));
    await publish(id, { kind: "session.started" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("unsubscribe stops delivery", async () => {
    const id = newSessionId();
    const received: SessionEvent[] = [];
    const off = await subscribe(id, (ev) => received.push(ev));
    await publish(id, { kind: "session.started" });
    off();
    await publish(id, { kind: "session.exit", data: { exitCode: 0 } });
    expect(received.map((e) => e.kind)).toEqual(["session.started"]);
    expect(listenerCount(id)).toBe(0);
  });

  test("session-id channel persists events to log", async () => {
    const id = newSessionId();
    await publish(id, { kind: "session.started" });
    // Verify it survives by re-reading the log directly
    const { readEvents } = await import("../../web/lib/session-log.js");
    const events = await readEvents(id);
    expect(events.map((e) => e.kind)).toEqual(["session.started"]);
  });

  test("goal-channel events do not write to session log", async () => {
    const goalChannel = "goal:abc123";
    const sessionId = newSessionId(); // unrelated session
    await publish(goalChannel, { kind: "goal.completed" });
    const { readEvents } = await import("../../web/lib/session-log.js");
    expect(await readEvents(sessionId)).toEqual([]);
  });

  test("replay-since delivers missed events on subscribe", async () => {
    const id = newSessionId();
    const e1 = await appendEvent(id, { kind: "session.started" });
    await new Promise((r) => setTimeout(r, 2));
    await appendEvent(id, { kind: "session.exit", data: { exitCode: 0 } });
    const received: SessionEvent[] = [];
    await subscribe(id, (ev) => received.push(ev), { replayFromTs: e1.ts });
    expect(received.map((e) => e.kind)).toEqual(["session.exit"]);
  });
});
