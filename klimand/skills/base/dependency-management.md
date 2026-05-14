---
name: dependency-management
description: Resolve sub-task ordering and parallelism based on inter-task dependencies.
triggers_on: [goal-decomposition]
version: "0.1"
---

A goal's sub-tasks form a small dependency graph. Decompose with the graph in mind, not just a linear list.

## What creates a dependency

- **File overlap.** Two sub-tasks that edit the same file must run sequentially. Their order matters.
- **Output consumption.** B references a symbol/file/migration that A creates ⇒ B depends on A.
- **Verification ordering.** A's verification is "test passes" and B will modify the test ⇒ A precedes B.

## What does NOT create a dependency

- Cosmetic ordering ("docs feel like they should come last").
- Same directory, different files, no shared types ⇒ parallelisable.
- Same provider — providers don't have global state across sessions.

## Output

After `goal-decomposition` produces the list, annotate each sub-task with:
- `depends_on: [n, m, ...]` — sub-task indices it cannot start before.
- `parallelisable: true|false` — whether it can run concurrently with its peers in the same dependency layer.

For now, the autonomy loop executes sequentially. The annotations are *forward-compatible*: when concurrent sub-task execution lands in a later phase, the same skill drives it. Annotate correctly now even though sequential execution will be used.

## Pitfalls

- Over-declaring dependencies (everything depends on the previous step) collapses parallelism prematurely.
- Under-declaring dependencies risks the loop running A and B concurrently when B silently needs A. Default to `depends_on` when unsure.
