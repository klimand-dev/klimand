---
name: output-evaluation
description: Decide whether a completed CLI session actually satisfied the sub-task's verification check.
triggers_on: [sub-task-complete]
version: "0.1"
---

A session ending without an error does not mean the sub-task is done. Evaluate the result against the **verification check** the decomposition produced, not against the CLI's self-assessment.

## Evaluation rubric

| Signal | Weight | Notes |
|---|---|---|
| Exit code | required | Non-zero ⇒ failure. Zero ⇒ proceed to other signals. |
| Verification check | required | Whatever `goal-decomposition` named ("tests pass", "file exists", "function returns X"). |
| Files changed match expectation | high | If the sub-task was "create migration", a diff with no `migrations/` change is a failure regardless of exit code. |
| Output mentions known failure phrases | medium | "could not", "unable to", "would require manual intervention" ⇒ probable failure. |
| Output mentions stub/TODO insertion | medium | "left as TODO", "stubbed out" ⇒ partial; treat as failure unless the sub-task explicitly permitted stubs. |

## Output

Produce one of three verdicts, in order of preference:
1. **pass** — verification check is satisfied. Proceed to the next sub-task.
2. **partial** — sub-task ran but a verification step is unmet. Re-dispatch with a tighter prompt referencing the unmet step. Re-dispatching counts against the per-goal retry budget.
3. **fail** — sub-task cannot be salvaged by re-prompting (e.g. environment is broken, the CLI is unauthenticated, the approach is dead-ended). Hand off to `failure-diagnosis`.

## Anti-patterns

- Trusting the CLI's "I completed the task" line. The artifact, not the self-report, is the source of truth.
- Calling a session "pass" because the user could fix the remaining gap in 30 seconds. The user is asleep. If it's not done, it's not pass.
- Promoting "partial" to "pass" because the retry budget is exhausted. If we can't finish it, the right answer is `escalation-judgement`, not lying about the outcome.
