import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import {
  appendEvent,
  newSessionId,
  readEvents,
  readEventsSince,
  appendStdout,
  writeSessionMeta,
  readSessionMeta
} from "../../web/lib/session-log.js";

let prev: string | undefined;

beforeEach(async () => {
  prev = process.env.KLIMAND_STATE_DIR;
  process.env.KLIMAND_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "klimand-session-"));
});

afterEach(() => {
  if (prev === undefined) delete process.env.KLIMAND_STATE_DIR;
  else process.env.KLIMAND_STATE_DIR = prev;
});

describe("session-log", () => {
  test("append then read round-trips", async () => {
    const id = newSessionId();
    await appendEvent(id, { kind: "session.started", data: { foo: 1 } });
    await appendEvent(id, { kind: "session.stdout", data: { chunk: "hello" } });
    const events = await readEvents(id);
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe("session.started");
    expect(events[0]!.data?.foo).toBe(1);
    expect(events[1]!.kind).toBe("session.stdout");
  });

  test("readEventsSince filters by timestamp", async () => {
    const id = newSessionId();
    const e1 = await appendEvent(id, { kind: "session.started" });
    // Force a strictly-later timestamp.
    await new Promise((r) => setTimeout(r, 2));
    const e2 = await appendEvent(id, { kind: "session.exit", data: { exitCode: 0 } });
    expect(e2.ts > e1.ts).toBe(true);
    const since = await readEventsSince(id, e1.ts);
    expect(since.map((e) => e.kind)).toEqual(["session.exit"]);
  });

  test("malformed lines are skipped, not thrown", async () => {
    const id = newSessionId();
    await appendEvent(id, { kind: "session.started" });
    // Manually corrupt the file
    const { appendFile } = await import("node:fs/promises");
    const { sessionDir } = await import("../../web/lib/session-log.js");
    await appendFile(path.join(sessionDir(id), "events.jsonl"), "{this is not json\n", "utf8");
    await appendEvent(id, { kind: "session.exit", data: { exitCode: 0 } });
    const events = await readEvents(id);
    expect(events.map((e) => e.kind)).toEqual(["session.started", "session.exit"]);
  });

  test("stdout chunks accumulate in stdout.log", async () => {
    const id = newSessionId();
    await appendStdout(id, "hello ");
    await appendStdout(id, "world\n");
    const { readFile } = await import("node:fs/promises");
    const { sessionDir } = await import("../../web/lib/session-log.js");
    const raw = await readFile(path.join(sessionDir(id), "stdout.log"), "utf8");
    expect(raw).toBe("hello world\n");
  });

  test("session meta round-trips", async () => {
    const id = newSessionId();
    await writeSessionMeta(id, { goalId: "g1", subTaskId: "st1", provider: "codex" });
    const meta = await readSessionMeta(id);
    expect(meta).toEqual({ goalId: "g1", subTaskId: "st1", provider: "codex" });
  });
});
