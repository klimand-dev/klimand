import { z } from "zod";
import { defineToolUiContract } from "../shared/contract";
import {
  ToolUIIdSchema,
  ToolUIReceiptSchema,
  ToolUIRoleSchema,
} from "../shared/schema";

export const TerminalPropsSchema = z.object({
  id: ToolUIIdSchema,
  role: ToolUIRoleSchema.optional(),
  receipt: ToolUIReceiptSchema.optional(),
  command: z.string(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().min(0),
  durationMs: z.number().optional(),
  cwd: z.string().optional(),
  truncated: z.boolean().optional(),
  maxCollapsedLines: z.number().min(1).optional(),
  className: z.string().optional(),
  // Runtime-only: live elapsed-time anchor and ticking gate. Optional so
  // serializable callers that don't supply these still type-check.
  startedAt: z.number().nullable().optional(),
  isRunning: z.boolean().optional(),
});

export type TerminalProps = z.infer<typeof TerminalPropsSchema>;

export const SerializableTerminalSchema = TerminalPropsSchema.omit({
  className: true,
});

export type SerializableTerminal = z.infer<typeof SerializableTerminalSchema>;

const SerializableTerminalSchemaContract = defineToolUiContract(
  "Terminal",
  SerializableTerminalSchema,
);

export const parseSerializableTerminal: (
  input: unknown,
) => SerializableTerminal = SerializableTerminalSchemaContract.parse;

export const safeParseSerializableTerminal: (
  input: unknown,
) => SerializableTerminal | null = SerializableTerminalSchemaContract.safeParse;
