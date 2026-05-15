import { Agent, run, user } from "@openai/agents";
import { z } from "zod";
import { getPrefs } from "./prefs";
import type {
  DecomposeInput,
  DispatchInput,
  EvaluateInput,
  EvaluationResult,
  DispatchResult,
  TaskAdvisor
} from "./autonomy-loop";
import { renderConsultedSkills } from "./klimand-skills";

const DEFAULT_MODEL = "gpt-5.4-mini";

// Match the SubTask shape on the autonomy-loop side — keep the schema flat and
// LLM-friendly so structured-output decoding stays reliable.
const DecomposedSubTaskSchema = z.object({
  description: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.enum(["claude", "codex", "claude-or-codex"]),
  verification: z.string().min(1),
  dependsOn: z.array(z.number().int().nonnegative())
});

const DecomposeOutputSchema = z.object({
  subTasks: z.array(DecomposedSubTaskSchema).min(1).max(20)
});

async function ensureOpenAIKey(): Promise<boolean> {
  if (process.env.OPENAI_API_KEY) return true;
  const prefs = await getPrefs().catch(() => null);
  if (prefs?.llm.openai.apiKey) {
    process.env.OPENAI_API_KEY = prefs.llm.openai.apiKey;
    return true;
  }
  return false;
}

function decomposeInstructions(skillsBlock: string): string {
  const base = [
    "You are Klimand's goal decomposer. Given a user-stated outcome and a stop condition, you produce an ordered list of verifiable sub-tasks.",
    "",
    "Output ONLY the structured JSON requested by the schema. Do not include any prose, preamble, or summary outside the JSON.",
    "",
    "Rules for each sub-task:",
    "- description: a short verb-phrase describing the work.",
    "- prompt: the exact instruction the CLI will receive. Self-contained and concrete; never reference the user.",
    "- provider: choose 'codex' for execution work (writing/editing files, running tests), 'claude' for reasoning-heavy steps (planning, code review, design), or 'claude-or-codex' if either could do it.",
    "- verification: a single objective check that proves this sub-task is done (file exists, test passes, command exits 0, output matches).",
    "- dependsOn: integer indices of earlier sub-tasks that must complete first. Use [] when this task is independent.",
    "",
    "Cap the plan at ~10 sub-tasks. If you need more, you have decomposed too finely — re-group."
  ].join("\n");
  return skillsBlock ? `${base}\n\n${skillsBlock}` : base;
}

function evaluateInstructions(skillsBlock: string): string {
  const base = [
    "You evaluate whether a Klimand CLI sub-task produced a passing result.",
    "Output structured JSON only.",
    "Verdict guidance:",
    "- pass: the verification check is satisfied and there are no clear errors in the session output.",
    "- partial: the work made progress but did not fully satisfy the verification. The runner will retry once.",
    "- fail: the sub-task failed and a retry is unlikely to help without intervention."
  ].join("\n");
  return skillsBlock ? `${base}\n\n${skillsBlock}` : base;
}

const EvaluateOutputSchema = z.object({
  verdict: z.enum(["pass", "partial", "fail"]),
  note: z.string().optional()
});

export interface AgentAdvisorOptions {
  // When true, decompose() returns deterministic placeholder sub-tasks instead of
  // calling the model. Useful for local smoke testing without an OpenAI key.
  stubDecompose?: boolean;
}

export function createAgentAdvisor(opts: AgentAdvisorOptions = {}): TaskAdvisor {
  return {
    async decompose(input: DecomposeInput) {
      if (opts.stubDecompose) {
        return [
          {
            description: `outline: ${input.goal.outcome}`,
            prompt: `Outline the steps needed to: ${input.goal.outcome}. Stop condition: ${input.goal.stopCondition}.`,
            provider: "claude" as const,
            verification: "claude returns an outline",
            dependsOn: []
          }
        ];
      }
      if (!(await ensureOpenAIKey())) {
        throw new Error("decompose: OPENAI_API_KEY not configured (set env or paste in Settings → BYOK)");
      }
      const skillsBlock = renderConsultedSkills(input.consultedSkills, "goal-decomposition");
      const agent = new Agent({
        name: "GoalDecomposer",
        model: process.env.OPENAI_AGENT_MODEL ?? DEFAULT_MODEL,
        instructions: decomposeInstructions(skillsBlock),
        outputType: DecomposeOutputSchema
      });
      const userMsg = [
        `Outcome: ${input.goal.outcome}`,
        `Stop condition: ${input.goal.stopCondition}`,
        input.goal.projectPath
          ? `Target project: ${input.goal.projectPath} (CLIs will execute against the real project)`
          : "No project — CLIs run in the scratch sandbox.",
        `Sub-task cap: ${input.goal.limits.maxSubTasks}`
      ].join("\n");
      const result = await run(agent, [user(userMsg)]);
      const out = result.finalOutput;
      if (!out) throw new Error("decompose: model returned no structured output");
      return out.subTasks.map((st) => ({
        description: st.description,
        prompt: st.prompt,
        provider: st.provider,
        verification: st.verification,
        dependsOn: st.dependsOn
      }));
    },
    async dispatch(_input: DispatchInput): Promise<DispatchResult> {
      // The goal-runner bypasses advisor.dispatch and drives the CLI directly via
      // runProvider so it can supply the broker callId and await completion in
      // one synchronous fiber. This stub stays here for the autonomy-loop tests
      // and any future async-dispatch path.
      return { sessionId: `dispatch-noop-${Date.now()}` };
    },
    async evaluate(input: EvaluateInput): Promise<EvaluationResult> {
      // v1: deterministic exit-code-based verdict. LLM-based evaluation is a
      // straightforward follow-up — swap the body for an Agent with
      // EvaluateOutputSchema when richer judgement is needed. The schema is
      // imported above so the upgrade is a body change only.
      void EvaluateOutputSchema;
      void evaluateInstructions;
      if (input.exitCode === 0) {
        return { verdict: "pass" };
      }
      return {
        verdict: "fail",
        note: `exit code ${input.exitCode}`
      };
    }
  };
}
