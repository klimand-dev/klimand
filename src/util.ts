import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_OPENAI_KEY]")
    .replace(/(sk-ant-[A-Za-z0-9_-]{12,})/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[REDACTED_TOKEN]")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^\s]+/gi, "$1[REDACTED]");
}
