import type { KlimandSkill, KlimandSkillTrigger } from "./types";
import type { KlimandSkillRegistry } from "./registry";

export interface ConsultContext {
  provider?: "claude" | "codex" | null;
  toolNames?: string[];
  hasProject?: boolean;
  flags?: Record<string, boolean>;
}

/**
 * Evaluates `applies_when` guards. The guard is a tiny boolean expression:
 *   - bare flag:           "has_project"           (truthy in context.flags or context.hasProject)
 *   - provider check:      "provider == 'claude'"  /  "provider != 'codex'"
 *   - tool check:          "tools.has('grep')"     /  "!tools.has('mcp__foo')"
 *   - boolean ops:         a && b, a || b, !a
 *
 * Anything we can't parse evaluates to true (skill still applies). The guard is a
 * hint, not a security boundary — the worst case is a skill being consulted
 * when it shouldn't be, which adds tokens but is recoverable.
 */
export function appliesWhen(expression: string | undefined, ctx: ConsultContext): boolean {
  if (!expression || expression.trim().length === 0) return true;
  try {
    return Boolean(evaluate(expression.trim(), ctx));
  } catch {
    return true;
  }
}

function evaluate(expr: string, ctx: ConsultContext): boolean {
  // Tokenise on || and && respecting precedence (|| weakest, && stronger, ! tightest).
  const orParts = splitTopLevel(expr, "||");
  if (orParts.length > 1) return orParts.some((p) => evaluate(p.trim(), ctx));
  const andParts = splitTopLevel(expr, "&&");
  if (andParts.length > 1) return andParts.every((p) => evaluate(p.trim(), ctx));
  let s = expr.trim();
  let negate = false;
  while (s.startsWith("!")) {
    negate = !negate;
    s = s.slice(1).trim();
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    return negate ? !evaluate(s.slice(1, -1), ctx) : evaluate(s.slice(1, -1), ctx);
  }
  const result = evaluateAtom(s, ctx);
  return negate ? !result : result;
}

function splitTopLevel(s: string, op: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && s.startsWith(op, i)) {
      out.push(buf);
      buf = "";
      i += op.length - 1;
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function evaluateAtom(atom: string, ctx: ConsultContext): boolean {
  // provider == 'x' or provider != 'x'
  const provMatch = atom.match(/^provider\s*(==|!=)\s*['"]([^'"]+)['"]$/);
  if (provMatch) {
    const eq = provMatch[1] === "==";
    const value = provMatch[2];
    return eq ? ctx.provider === value : ctx.provider !== value;
  }
  // tools.has('x')
  const toolsMatch = atom.match(/^tools\.has\(\s*['"]([^'"]+)['"]\s*\)$/);
  if (toolsMatch) {
    return (ctx.toolNames ?? []).includes(toolsMatch[1]!);
  }
  // bare identifier (flag)
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(atom)) {
    if (atom === "has_project") return Boolean(ctx.hasProject);
    if (atom === "true") return true;
    if (atom === "false") return false;
    if (ctx.flags && Object.prototype.hasOwnProperty.call(ctx.flags, atom)) {
      return Boolean(ctx.flags[atom]);
    }
    return false;
  }
  // Anything else is unparseable — let the outer catch in appliesWhen fail open.
  throw new Error(`unparseable atom: ${atom}`);
}

/**
 * Consult the registry for skills that apply at this trigger point.
 * Returns the skills in stable name-order.
 */
export function consult(
  registry: KlimandSkillRegistry,
  trigger: KlimandSkillTrigger,
  ctx: ConsultContext = {}
): KlimandSkill[] {
  const candidates = registry.byTrigger.get(trigger) ?? [];
  return candidates
    .filter((s) => appliesWhen(s.appliesWhen, ctx))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Render the consulted skills as a single Markdown block suitable for
 * inclusion in a model's system prompt. Includes a header section that
 * lists which skills are being consulted, then their bodies separated by
 * heading rules.
 */
export function renderConsultedSkills(skills: KlimandSkill[], trigger: KlimandSkillTrigger): string {
  if (skills.length === 0) return "";
  const header = `## Klimand skills (trigger: ${trigger})`;
  const intro = skills.length === 1
    ? `One Klimand skill applies at this decision point.`
    : `${skills.length} Klimand skills apply at this decision point. Apply each one; if they conflict, prefer the more specific (project > user > bundled).`;
  const bodies = skills.map((s) => `### ${s.name} (${s.source.kind}, v${s.version})\n${s.description}\n\n${s.body.trim()}`);
  return `${header}\n\n${intro}\n\n${bodies.join("\n\n---\n\n")}`;
}
