import { z } from "zod";

export const KLIMAND_SKILL_TRIGGERS = [
  "goal-start",
  "goal-decomposition",
  "sub-task-dispatch",
  "sub-task-complete",
  "sub-task-failed",
  "ambiguity-detected",
  "session-running"
] as const;

export type KlimandSkillTrigger = (typeof KLIMAND_SKILL_TRIGGERS)[number];

export const KlimandSkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case ([a-z0-9-])"),
  description: z.string().min(1),
  triggers_on: z.array(z.enum(KLIMAND_SKILL_TRIGGERS)).min(1),
  applies_when: z.string().optional(),
  version: z.string().default("0.1")
});

export type KlimandSkillFrontmatter = z.infer<typeof KlimandSkillFrontmatterSchema>;

export interface KlimandSkillSource {
  kind: "bundled" | "user" | "project";
  path: string;
}

export interface KlimandSkill {
  name: string;
  description: string;
  triggers: KlimandSkillTrigger[];
  appliesWhen?: string;
  version: string;
  body: string;
  source: KlimandSkillSource;
}

export interface KlimandSkillLoadError {
  path: string;
  source: KlimandSkillSource["kind"];
  message: string;
}

export interface KlimandSkillLoadResult {
  skills: KlimandSkill[];
  errors: KlimandSkillLoadError[];
}
