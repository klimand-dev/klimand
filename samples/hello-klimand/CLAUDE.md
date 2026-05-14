# hello-klimand

This is a sample project shipped with Klimand so you can see the project view in action without pointing it at one of your real repos.

## What this project is

A toy demo that shows Klimand how a project explains itself to its agents:
- A `CLAUDE.md` (this file) — used by Claude Code as the project's persistent context.
- An `AGENTS.md` — used by Codex for the same purpose.
- A `.mcp.json` — declares two example MCP servers.
- A `.claude/commands/ship.md` — a slash command Claude Code can call.

## How to use it

When you bind a thread to this project, the orchestrator gets a digest of all the above and routes between Claude Code and Codex with that context in mind.

## House style

- Prefer small commits with clear titles.
- Run `npm test` before declaring a task complete.
- Always update `CHANGELOG.md` when changing behavior the user could notice.

## Routing hints

- Prefer **Claude Code** for: refactoring, code reviews, writing tests.
- Prefer **Codex** for: scaffolding new files, glue scripts, one-off transforms.
