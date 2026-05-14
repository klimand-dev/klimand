---
name: git-hygiene
description: Keep the working tree, staging area, and commit history clean across a multi-sub-task goal.
triggers_on: [sub-task-complete]
applies_when: has_project
version: "0.1"
---

When the autonomy loop spans many sub-tasks, git discipline is what keeps the change reviewable.

## Rules

1. **One commit per pass-verdict sub-task.** If the sub-task changed files, the CLI should produce a commit before returning. If it didn't, the orchestrator should not paper over it — re-dispatch with a tighter prompt that explicitly says "commit at the end".
2. **Commit message style follows the project.** Read the last 5 commits to detect the style (Conventional Commits, plain, etc.) and match it. Do not impose Conventional Commits if the project doesn't use them.
3. **Never amend a commit the user could have already seen.** Each retry within a sub-task produces fresh commits; do not squash retroactively.
4. **Never push.** Pushing is a user-visible action and requires explicit user authorisation. The autonomy loop stays on the local branch.
5. **Never force-push.** Even if the user later asks for a force-push, the orchestrator does not do this autonomously — only the user does, by typing the command.
6. **Branch management is not the orchestrator's job.** Run on whatever branch the user is on. If the goal seems to imply a new branch ("ship feature X"), include creating the branch as an explicit early sub-task with the user's approval baked in — do not switch branches silently.

## What "clean" means at goal completion

- `git status` shows no uncommitted changes.
- The branch is ahead of its upstream by N commits where N matches the count of passed sub-tasks that produced commits.
- No `WIP` or `fixup!` commits remain.

If the working tree isn't clean at the end, the goal is not complete — re-evaluate via `completion-detection`.
