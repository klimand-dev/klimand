# hello-klimand — for Codex

Mirror of `CLAUDE.md` tuned for Codex's prompt format.

## Build / test

- `npm install`
- `npm test`

## Conventions

- TypeScript strict mode.
- No `any` without an inline justification comment.
- Each public function gets a one-line JSDoc when it isn't obvious.

## Don't

- Don't introduce new top-level dependencies without flagging in the PR description.
- Don't commit lockfile changes unrelated to your change.
