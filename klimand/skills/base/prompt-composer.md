---
name: prompt-composer
description: Compose a CLI prompt that maximises the user's existing project harness — slash commands, subagents, skills, MCP servers.
triggers_on: [sub-task-dispatch]
version: "0.1"
---

A great Klimand prompt is short, specific, and **leans hard on what the project already has**. The user spent real effort wiring their CLI; honour that.

## Composition rules

1. **Lead with the goal in one sentence.** Not a paragraph. The CLI's own planner is competent.
2. **Reference project artifacts by name, not by re-description.** If the project has a `/test` slash command, write `Run /test after changes` — do not re-spec "run `npm test` and verify exit 0". The CLI will resolve `/test` against the real `.claude/commands/`.
3. **Invoke subagents when one fits.** If the project has a `@code-reviewer` subagent and the sub-task is "review the diff", write `Have @code-reviewer look at the staged changes`. Do not duplicate that agent's instructions inline.
4. **Name relevant skills.** If `.claude/skills/migration.md` exists and the sub-task involves a schema change, mention "follow the migration skill" rather than re-listing its rules.
5. **Honour CLAUDE.md / AGENTS.md.** Quote any rule from the digest that constrains this sub-task verbatim once — do not paraphrase it (paraphrasing risks drift).
6. **State the verification step explicitly.** "Done means: tests pass and there is a commit on the current branch with `git status` clean."
7. **Keep it under 12 lines.** If the prompt grows longer, the decomposition was too coarse — split the sub-task.

## What NOT to do

- Do not include the user's original outcome verbatim in every sub-task's prompt. Each sub-task gets only the slice it needs.
- Do not list every file in the project. The CLI can `grep` for itself.
- Do not pre-paste large code excerpts unless the sub-task is specifically about transforming them.
- Do not include retry logic or fallbacks. If this attempt fails, `failure-diagnosis` will handle the next step.

## Template

```
Goal: <one-sentence sub-task outcome>

Context:
- Project root is mounted at the sandbox path.
- <quote one CLAUDE.md/AGENTS.md rule if relevant, verbatim>
- <relevant slash command / subagent / skill by name>

Do:
1. <first concrete action>
2. <second concrete action>

Done when: <verification check>
```
