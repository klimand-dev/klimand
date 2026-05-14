import { run, user, assistant, system } from "@openai/agents";
import { createUIMessageStream } from "ai";
import type { UIMessage } from "ai";
import { makeAgent } from "./agent";
import { getPrefs } from "./prefs";
import { getDoctor } from "./doctor";
import { touchThread, getThread } from "./threads";
import { getProfile } from "./project-profile";
import { getRegistry } from "./klimand-skills";

type AnyMessagePart = { type: string; text?: string };

function extractText(m: UIMessage): string {
  const parts = (m.parts ?? []) as AnyMessagePart[];
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function messagesToAgentInput(messages: UIMessage[]) {
  return messages
    .map((m) => {
      const text = extractText(m);
      if (!text) return null;
      if (m.role === "user") return user(text);
      if (m.role === "assistant") return assistant(text);
      if (m.role === "system") return system(text);
      return null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

interface ToolCallItemLike {
  rawItem?: { callId?: string; name?: string; arguments?: string };
}

interface ToolOutputItemLike {
  rawItem?: { callId?: string };
  output?: unknown;
}

interface RawModelEventLike {
  type: "raw_model_stream_event";
  data?: { type?: string; delta?: string };
}

interface RunItemEventLike {
  type: "run_item_stream_event";
  name: string;
  item?: ToolCallItemLike & ToolOutputItemLike;
}

type AgentStreamEvent = RawModelEventLike | RunItemEventLike | { type: string };

export function runAgentAsUIStream(messages: UIMessage[], opts: { threadId?: string } = {}) {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = `txt_${Date.now()}`;

      const [prefs, doctor] = await Promise.all([getPrefs(), getDoctor()]);

      // BYOK fallback: env first, then user-pasted key from prefs.
      if (!process.env.OPENAI_API_KEY && prefs.llm.openai.apiKey) {
        process.env.OPENAI_API_KEY = prefs.llm.openai.apiKey;
      }
      if (!process.env.OPENAI_API_KEY) {
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta:
            "OpenAI key not configured. Paste one in Settings → BYOK, or set `OPENAI_API_KEY` in your environment, then send again."
        });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
        return;
      }
      let threadContext: string | undefined;
      let projectPath: string | undefined;
      let projectDigest: string | undefined;
      if (opts.threadId) {
        const thread = await getThread(opts.threadId).catch(() => null);
        if (thread?.projectPath) {
          projectPath = thread.projectPath;
          try {
            const { digest } = await getProfile(thread.projectPath);
            projectDigest = digest;
          } catch {
            /* if the project disappears or becomes invalid, fall back silently to no-digest */
          }
        }
        if (thread?.context) threadContext = thread.context;
      }
      const skillRegistry = await getRegistry({ projectPath: projectPath ?? null }).catch(() => undefined);
      const agent = makeAgent({
        prefs,
        doctor,
        projectDigest,
        skillRegistry,
        hasProject: Boolean(projectPath)
      });
      const input = messagesToAgentInput(messages);
      if (threadContext) {
        input.unshift(system(`Thread context (from URL ingest):\n${threadContext}`));
      }
      if (input.length === 0) {
        writer.write({ type: "start" });
        writer.write({ type: "finish" });
        return;
      }

      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      const openTextIds = new Set<string>();
      let currentTextId: string | null = null;
      const openTool = (id: string, name: string) => {
        writer.write({ type: "tool-input-start", toolCallId: id, toolName: name });
      };

      const ensureTextOpen = () => {
        if (currentTextId) return currentTextId;
        const id = `txt_${Date.now()}_${openTextIds.size}`;
        writer.write({ type: "text-start", id });
        openTextIds.add(id);
        currentTextId = id;
        return id;
      };
      const closeText = () => {
        if (!currentTextId) return;
        writer.write({ type: "text-end", id: currentTextId });
        currentTextId = null;
      };

      try {
        const result = await run(agent, input, {
          stream: true,
          context: { prefs, threadId: opts.threadId, projectPath }
        });
        for await (const event of result as AsyncIterable<AgentStreamEvent>) {
          if (event.type === "raw_model_stream_event") {
            const data = (event as RawModelEventLike).data;
            if (data?.type === "output_text_delta" && typeof data.delta === "string") {
              const id = ensureTextOpen();
              writer.write({ type: "text-delta", id, delta: data.delta });
            }
            continue;
          }
          if (event.type === "run_item_stream_event") {
            const e = event as RunItemEventLike;
            if (e.name === "tool_called" && e.item?.rawItem?.callId && e.item?.rawItem?.name) {
              closeText();
              const callId = e.item.rawItem.callId;
              const name = e.item.rawItem.name;
              openTool(callId, name);
              let parsedArgs: unknown = {};
              try {
                if (e.item.rawItem.arguments) parsedArgs = JSON.parse(e.item.rawItem.arguments);
              } catch {
                /* leave as empty object */
              }
              writer.write({ type: "tool-input-available", toolCallId: callId, toolName: name, input: parsedArgs });
              continue;
            }
            if (e.name === "tool_output" && e.item?.rawItem?.callId) {
              const callId = e.item.rawItem.callId;
              writer.write({ type: "tool-output-available", toolCallId: callId, output: e.item.output ?? null });
              continue;
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const id = ensureTextOpen();
        writer.write({ type: "text-delta", id, delta: `\n\n[agent error: ${message}]` });
      }

      closeText();
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });

      if (opts.threadId) {
        await touchThread(opts.threadId).catch(() => {});
      }
    }
  });
}
