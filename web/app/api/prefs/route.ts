import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrefs, setPrefs } from "@/lib/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PartialPrefsSchema = z.object({
  routingHints: z.string().optional(),
  approval: z.enum(["auto", "ask"]).optional(),
  claude: z
    .object({
      model: z.string().optional(),
      permissionMode: z.enum(["bypassPermissions", "plan", "ask"]).optional(),
      extraArgs: z.string().optional()
    })
    .partial()
    .optional(),
  codex: z
    .object({
      model: z.string().optional(),
      sandboxMode: z.enum(["workspace-write", "read-only"]).optional(),
      extraArgs: z.string().optional()
    })
    .partial()
    .optional()
});

export async function GET(): Promise<Response> {
  const prefs = await getPrefs();
  return NextResponse.json(prefs);
}

export async function PUT(req: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PartialPrefsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid prefs", issues: parsed.error.issues }, { status: 400 });
  }
  const updated = await setPrefs(parsed.data);
  return NextResponse.json(updated);
}
