/**
 * A small heuristic for "does this look like a goal, not a chat turn?"
 *
 * Goal-shaped requests typically have:
 *   - an outcome verb (ship, build, implement, add, refactor, migrate, fix)
 *   - multiple steps implied (or expressed via 'and', commas, 'then')
 *   - non-trivial length (rules out greetings and one-liners)
 *
 * The detector is conservative on purpose. False positives are worse than false
 * negatives — annoying a chat user with an offer they didn't want is bad UX.
 * The user can always switch modes manually.
 */

const OUTCOME_VERBS = [
  "ship",
  "build",
  "implement",
  "add",
  "create",
  "refactor",
  "migrate",
  "fix",
  "convert",
  "deploy",
  "set up",
  "wire up",
  "scaffold",
  "rewrite",
  "extract"
];

export interface GoalShapeSignals {
  isGoalShaped: boolean;
  confidence: "low" | "medium" | "high";
  reasons: string[];
}

export function detectGoalShape(message: string): GoalShapeSignals {
  const reasons: string[] = [];
  const lower = message.toLowerCase();

  if (message.length < 30) {
    return { isGoalShaped: false, confidence: "low", reasons: ["too short"] };
  }

  const verbHit = OUTCOME_VERBS.find((v) => lower.includes(v));
  if (verbHit) reasons.push(`contains outcome verb: ${verbHit}`);

  const stepWords = ["then", "after", "next", "finally", " and ", ",", " with "];
  const stepHits = stepWords.filter((w) => lower.includes(w));
  if (stepHits.length >= 2) reasons.push(`multi-step signals: ${stepHits.join(", ")}`);

  const hasTests = /\btests?\b/.test(lower);
  if (hasTests) reasons.push("mentions tests");

  const hasFiles = /\b(file|files|module|component|migration|endpoint|route|api|schema)\b/.test(lower);
  if (hasFiles) reasons.push("mentions code artifacts");

  const score = reasons.length;
  if (verbHit && score >= 2) return { isGoalShaped: true, confidence: "high", reasons };
  if (verbHit && score >= 1) return { isGoalShaped: true, confidence: "medium", reasons };
  if (score >= 2) return { isGoalShaped: true, confidence: "low", reasons };
  return { isGoalShaped: false, confidence: "low", reasons };
}
