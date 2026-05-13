import { appendFile } from "node:fs/promises";
import path from "node:path";
import { AuditEvent } from "./types.js";
import { ensureDir, redactSecrets } from "./util.js";

export class AuditLog {
  readonly file: string;

  constructor(stateDir: string) {
    this.file = path.join(stateDir, "audit.jsonl");
  }

  async append(event: AuditEvent): Promise<void> {
    await ensureDir(path.dirname(this.file));
    const line = redactSecrets(JSON.stringify(event));
    await appendFile(this.file, `${line}\n`, "utf8");
  }
}
