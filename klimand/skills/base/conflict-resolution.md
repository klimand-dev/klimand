---
name: conflict-resolution
description: Resolve conflicts when multiple agents have touched the same file or undone each other's work.
triggers_on: [sub-task-complete]
applies_when: has_project
version: "0.1"
---

In a multi-sub-task goal, two providers can step on each other. Detect and resolve before the goal completes.

## Detection

After each sub-task completes, check:
- Did this sub-task modify a file that a previous sub-task in the same goal also modified?
- Did this sub-task revert a change a previous sub-task made (look for symbol deletions matching prior insertions)?
- Did this sub-task overwrite a section that the prior sub-task explicitly produced?

If any answer is yes, you have a potential conflict.

## Resolution

1. **Read both changes** — the prior commit's diff and the current sub-task's diff — before doing anything else.
2. **Decide the intent.** Usually one of:
   - The second sub-task was correct to override (it had more context or a stricter spec).
   - The first sub-task was correct and the second sub-task didn't realise the first existed.
   - Both are partially right; the resolution is a merge of the two.
3. **Re-dispatch a reconciliation sub-task** if the resolution requires non-trivial judgement. Provide both diffs in the prompt. Pick the provider whose original contribution was more nuanced (likely Claude).

## Anti-patterns

- "Last write wins" — silently accepting the second sub-task's overwrite without checking the first's intent.
- Filing a follow-up TODO instead of resolving. By goal completion, the conflict must be resolved.
- Running an autonomous `git merge` strategy on logically conflicting code changes. The orchestrator does not heuristically merge code; it dispatches a sub-task to do it.
