---
name: escalation-judgement
description: Decide when to stop the autonomy loop and surface a decision to the user.
triggers_on: [sub-task-failed, ambiguity-detected]
version: "0.1"
---

Some calls are not the orchestrator's to make. Recognise them and stop.

## Always escalate

- A sub-task requires credentials the user hasn't provided (production database password, API key for a paid service that's not in `OPENAI_API_KEY`/BYOK, signing certs).
- A sub-task would push to a remote, deploy, publish a package, post to social media, send an email, or make any user-visible external change.
- A sub-task would modify a file the user has flagged as sensitive (e.g. anything in `.env`, secrets, `id_rsa`, signing keys).
- The diagnosis is "the user's stated outcome conflicts with a stated project rule" (e.g. they asked to "remove all tests" but `CLAUDE.md` says "tests are required"). Don't pick a side.
- Cumulative API spend on this goal exceeds the per-goal budget (default $5; configurable).
- The same sub-task has failed for two different reasons. The strategy is wrong; the user should pick the next move.

## Escalation format

Pause the loop and produce a notification with:
1. **What was being attempted** — the sub-task description.
2. **Why it can't proceed** — one sentence in the user's terms, not error spew.
3. **Two or three concrete options** — each with the user action it takes. Avoid "let me try again", which is what the autonomy loop already does.

Resume only after the user picks an option. Do not time-out into a default action.

## What is NOT an escalation

- Transient CLI failures that retry would fix.
- A spec ambiguity that `prompt-composer` can tighten its way out of.
- "I think there's a better way" — that's a comment, not a blocker.
