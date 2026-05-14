---
name: routing-decision
description: Pick the right CLI (Claude Code or Codex) for a single sub-task.
triggers_on: [sub-task-dispatch]
version: "0.1"
---

Pick **one** provider per sub-task. Do not mix.

## Decision heuristic

Route to **Claude Code** when the sub-task is dominated by:
- Reasoning, planning, or design decisions ("decide which approach", "review for race conditions")
- Reading or summarising large amounts of existing code
- Writing prose: docs, ADRs, commit messages, PR descriptions
- Multi-file refactors where the *what* is ambiguous and needs judgement
- Anything that benefits from extended thinking

Route to **Codex** when the sub-task is dominated by:
- Mechanical edits where the spec is already clear ("change all `foo()` to `bar()`")
- Running shell commands, executing tests, applying patches
- Writing new code from a clear specification (the spec was just produced by Claude in a prior step)
- Database migrations, scripted file generation
- Anything where Codex's faster execution loop is the bottleneck

## Tie-breakers

- If user routing preferences in the system prompt name a CLI, honour them over this heuristic.
- If only one CLI is installed/authenticated according to `Tool availability (live)`, you must use that one. Note in your preamble that the other was unavailable.
- For sub-tasks that touch tests, prefer the CLI that wrote the code under test (consistency in style and assumptions).

## Anti-patterns

- Splitting "design + implement" into a single sub-task and routing to Codex. Decompose first.
- Routing back-to-back identical sub-tasks to alternating providers. Pick one and stay there unless there's a reason to switch.
- Using Claude for trivial single-line edits — Codex is faster.
