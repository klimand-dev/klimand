---
name: failure-diagnosis
description: Diagnose a failed sub-task and decide retry vs. pivot vs. escalate.
triggers_on: [sub-task-failed]
version: "0.1"
---

A failure is information. Use it.

## Diagnostic flow

1. **Read the actual error.** Not the summary, not the exit code alone — the last 30 lines of the session output. Identify the failure mode:
   - **Environmental** — missing tool, missing auth, missing dependency, network. → fix the environment, then retry the same prompt.
   - **Spec ambiguity** — CLI did something different from intent because the prompt allowed it. → tighten the prompt, retry.
   - **Wrong approach** — the strategy itself is flawed (e.g. trying to add a feature without first reading the relevant module). → pivot: re-decompose, often into more steps.
   - **External blocker** — needs human approval, requires credentials only the user has, depends on an unfinished decision. → escalate via `escalation-judgement`.
   - **Already done** — the verification check is now satisfied even though the CLI exited non-zero. Rare but real. → re-evaluate; may be a pass.

2. **Check retry budget.** Default cap: 2 retries per sub-task. If already at the cap, do not retry again — pivot or escalate. Burning budget on the same prompt is wasted work.

3. **Vary the strategy on retry.** Never retry an identical prompt. The smallest valid retry adds one sentence of new information (e.g. "the previous attempt failed because X — handle that this time").

4. **Switch providers as a last resort.** If Claude failed an implementation, Codex retrying often won't help unless the failure was Claude-specific (e.g. ran out of context). Provider switch is the move when the *kind* of work was misrouted.

## What never to do

- Retry with `--force` flags, `--no-verify`, or anything that bypasses a safety check. If a hook failed, fix the underlying issue.
- Add `|| true` or other fail-swallowing constructs to make a verification check pass artificially.
- Mark a failed sub-task as skipped without producing a `partial` evaluation and a documented reason.
