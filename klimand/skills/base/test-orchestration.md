---
name: test-orchestration
description: Decide when and how to run the project's tests after a code-touching sub-task.
triggers_on: [sub-task-complete]
applies_when: has_project
version: "0.1"
---

If the most recent sub-task changed code in a project with tests, run them. Test execution is part of the verification step, not an afterthought.

## When to run

Run tests when **any** of these is true:
- The sub-task created or modified files under any path matching common source roots (`src/`, `lib/`, `app/`, `internal/`, `pkg/`, language-specific equivalents).
- The sub-task added or modified test files.
- The project's `CLAUDE.md` or `AGENTS.md` says "always run tests after changes".

Do **not** run tests when:
- The sub-task only touched docs (`*.md`, `docs/`), config samples, or assets.
- The verification step from decomposition already specified a more specific check (e.g. "running the migration succeeds") — that check is sufficient.

## How to run

1. Prefer the project's own test command. Discover it in this order:
   - A `/test`, `/check`, or `/verify` slash command in `.claude/commands/` — use that.
   - `package.json#scripts.test`, `cargo test`, `go test ./...`, `pytest`, etc. — fall back to convention.
2. Run the full suite, not a single file — partial runs hide regressions in code the sub-task didn't directly touch.
3. If the suite takes longer than a few minutes, the orchestrator should still wait. Durable execution covers long sessions.

## On test failure

- Treat test failure as a `fail` evaluation of the *current* sub-task even if its narrow verification passed. The sub-task broke something.
- The retry should focus on the regression: include the failing test name and the relevant error in the next prompt.
- Never disable a test, mark it as `xfail`, or add a skip to make the suite green. If the test is genuinely wrong, the right action is to escalate.
