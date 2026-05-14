---
name: ship
description: Run lint, typecheck, and tests, then open a PR.
---

Run these in order, stopping at the first failure:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `gh pr create --fill`

If any step fails, summarize the failure and stop — don't create the PR.
