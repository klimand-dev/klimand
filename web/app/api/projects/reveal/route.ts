import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import { validateProjectPath, ProjectPathError } from "@/lib/project-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RevealBody {
  projectPath?: string;
  path?: string;
  mode?: "open" | "folder";
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function spawnDetached(cmd: string, args: string[]): void {
  // Fire and forget — we don't wait, don't capture output, don't reuse runCli.
  // Detach so the spawned process survives this request.
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
    child.unref();
  } catch {
    /* swallow — caller surfaces a generic 500 on failure */
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: RevealBody = {};
  try {
    body = (await req.json()) as RevealBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const mode = body.mode;
  if (mode !== "open" && mode !== "folder") {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }
  if (!body.projectPath || !body.path) {
    return NextResponse.json({ error: "missing projectPath or path" }, { status: 400 });
  }

  // Validate projectPath against the same blocklist + marker requirement
  // used by the scanner. This is the trust root for what counts as a project.
  let project: string;
  try {
    project = await validateProjectPath(body.projectPath);
  } catch (e) {
    if (e instanceof ProjectPathError) {
      return NextResponse.json({ error: e.kind, message: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "validation_failed" }, { status: 500 });
  }

  // The target must live under the validated project root. No traversal.
  const target = path.resolve(body.path);
  if (!isUnder(target, project)) {
    return NextResponse.json({ error: "target_outside_project" }, { status: 400 });
  }

  // The target may not exist yet (e.g., user wants to reveal-and-create); for
  // "folder" we still want to open the parent dir even if the file is absent,
  // but for "open" we require the file to actually exist.
  if (mode === "open") {
    try {
      await stat(target);
    } catch {
      return NextResponse.json({ error: "not_found", message: target }, { status: 404 });
    }
  }

  const plat = process.platform;
  if (mode === "open") {
    if (plat === "win32") spawnDetached("cmd.exe", ["/c", "start", "", target]);
    else if (plat === "darwin") spawnDetached("open", [target]);
    else spawnDetached("xdg-open", [target]);
  } else {
    // "folder": show the file selected in its parent dir.
    if (plat === "win32") spawnDetached("explorer.exe", [`/select,${target}`]);
    else if (plat === "darwin") spawnDetached("open", ["-R", target]);
    else {
      const parent = path.dirname(target);
      spawnDetached("xdg-open", [parent]);
    }
  }

  return NextResponse.json({ ok: true, target, mode });
}
