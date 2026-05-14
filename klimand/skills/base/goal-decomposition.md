---
name: goal-decomposition
description: Break a user-stated outcome into an ordered list of verifiable sub-tasks.
triggers_on: [goal-start, goal-decomposition]
version: "0.1"
---

When the user states an outcome, do not start dispatching CLI work until you have decomposed it.

1. Restate the outcome in one sentence in your own words. If it is ambiguous (more than one reasonable interpretation), ask one clarifying question and stop. Do not guess.
2. List the sub-tasks in the order they must run. Each sub-task must satisfy:
   - **Verifiable**: it has a check that says "done" objectively (file exists, test passes, command exits 0, output matches a pattern).
   - **Single-provider**: one CLI handles it end-to-end. Splitting a sub-task across CLIs creates handoff bugs.
   - **Single concern**: one design decision or one mechanical change. "Refactor X and add Y" is two sub-tasks.
3. Bound the plan. If you see more than ~10 sub-tasks, you have decomposed too finely. Re-group.
4. Identify hard dependencies between sub-tasks (B can only start after A completes). If two sub-tasks are independent, mark them parallelisable.
5. State the **stop condition** for the whole goal: a single observable signal that all sub-tasks completed successfully (e.g. "tests pass + lint clean + a commit named `feat: X` exists").

Output shape (one sub-task per line):
```
1. [provider] short verb-phrase description — verify: <check>
2. [provider] ...
```

Hard rules:
- Never propose a sub-task that requires the user to take action between CLI calls. The user is asleep.
- Never propose "explore the codebase first" as a sub-task. Decomposition itself is the exploration; do it once, up front.
- Treat the project profile as authoritative. If `CLAUDE.md` says "always run `npm test` after edits", that becomes a verification step on every code-touching sub-task automatically — do not list it separately.
