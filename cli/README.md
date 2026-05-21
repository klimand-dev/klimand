# klimand

> Local orchestrator for Claude Code + Codex with project-config awareness. **One chat, two agents, real project awareness.**

```bash
npx klimand
```

That's it. Klimand opens a browser, scans your home directory + common dev folders, lets you approve the projects you care about, and drops you into a chat thread bound to your first project. Type a goal — the orchestrator (gpt-5.x router) picks Claude Code or Codex per turn and streams the session live.

No API key paste required for the CLI runs themselves (Claude Code and Codex use their own auth). The orchestrator's router needs an OpenAI key; paste it in **Settings → BYOK** the first time you send a message, or set `OPENAI_API_KEY` in your environment.

## What you get

- Multi-CLI routing — Claude Code and Codex as peers; the router picks per turn
- Project-config awareness — reads `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, slash commands, subagents, skills, hooks before deciding
- Threaded chats — switch between conversations, each with its own sandbox
- Scheduled runs — fire-and-forget cron-based agent runs
- Cancel any in-flight CLI call from the tool card

## Links

- Home: https://klimand.com
- Repo: https://github.com/klimand-dev/klimand
- License: Apache-2.0
