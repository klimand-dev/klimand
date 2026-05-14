---
name: completion-detection
description: Decide whether the overall goal — not just the most recent sub-task — is fully met.
triggers_on: [sub-task-complete]
version: "0.1"
---

After each sub-task passes, check whether the whole goal is complete. Do not assume "last sub-task done" equals "goal done"; new information from execution may have revealed missing work.

## Completion check

The goal is complete when **all** of these hold:
1. Every planned sub-task has a `pass` verdict (no `partial`, no `fail`).
2. The **stop condition** stated during decomposition is satisfied. Re-check it explicitly, not from memory.
3. No new follow-up work was uncovered by execution that the user would consider in-scope.

If any condition fails, the goal is not done. Either:
- Append new sub-tasks (if execution revealed real missing work) and continue the loop, or
- Stop and escalate (if the user has to make a call before more work can happen).

## What counts as "new follow-up the user would consider in-scope"

- A sub-task created a TODO or a stub. The user did not ask for stubs; they asked for the outcome.
- A sub-task fixed a symptom but the underlying cause is still there and will re-surface.
- A sub-task touched a file that lacks tests and the project's `CLAUDE.md` requires tests for changed files.

## What does NOT count as in-scope

- Adjacent improvements the agent thinks of mid-execution (refactor X, modernise Y).
- Cleaning up TODOs that were already in the file before the goal started.
- Anything outside the directory hierarchy the goal mentioned.

When in doubt, append the sub-task. The autonomy loop has hard limits; it will halt if scope balloons. The opposite — declaring done early — leaves the user with broken work.
