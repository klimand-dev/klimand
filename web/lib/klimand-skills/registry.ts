import { loadKlimandSkills, type LoadKlimandSkillsOptions } from "./loader";
import type { KlimandSkill, KlimandSkillLoadError, KlimandSkillTrigger } from "./types";

export interface KlimandSkillRegistry {
  skills: KlimandSkill[];
  errors: KlimandSkillLoadError[];
  byTrigger: Map<KlimandSkillTrigger, KlimandSkill[]>;
  loadedAt: number;
  projectPath: string | null;
}

interface CacheEntry {
  registry: KlimandSkillRegistry;
  expiresAt: number;
}

const TTL_MS = 5_000;
const G = globalThis as unknown as { __klimandSkillsRegistry?: Map<string, CacheEntry> };
function cacheMap(): Map<string, CacheEntry> {
  if (!G.__klimandSkillsRegistry) G.__klimandSkillsRegistry = new Map();
  return G.__klimandSkillsRegistry;
}

function buildRegistry(
  skills: KlimandSkill[],
  errors: KlimandSkillLoadError[],
  projectPath: string | null
): KlimandSkillRegistry {
  const byTrigger = new Map<KlimandSkillTrigger, KlimandSkill[]>();
  for (const skill of skills) {
    for (const trigger of skill.triggers) {
      const list = byTrigger.get(trigger) ?? [];
      list.push(skill);
      byTrigger.set(trigger, list);
    }
  }
  return { skills, errors, byTrigger, loadedAt: Date.now(), projectPath };
}

export async function getRegistry(opts: LoadKlimandSkillsOptions = {}): Promise<KlimandSkillRegistry> {
  const key = opts.projectPath ?? "<global>";
  const now = Date.now();
  const cache = cacheMap();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.registry;
  const { skills, errors } = await loadKlimandSkills(opts);
  const registry = buildRegistry(skills, errors, opts.projectPath ?? null);
  cache.set(key, { registry, expiresAt: now + TTL_MS });
  return registry;
}

export function invalidateRegistry(projectPath?: string | null): void {
  const cache = cacheMap();
  if (projectPath === undefined) {
    cache.clear();
    return;
  }
  cache.delete(projectPath ?? "<global>");
}

/**
 * Test-only helper: build a registry directly from a skill list without filesystem I/O.
 */
export function buildRegistryFromSkills(
  skills: KlimandSkill[],
  errors: KlimandSkillLoadError[] = [],
  projectPath: string | null = null
): KlimandSkillRegistry {
  return buildRegistry(skills, errors, projectPath);
}
