---
name: goal
description: Drive Klimand to first paying Pro customer. One phase per invocation; pair with /loop /goal to chain through.
---

# Klimand Adoption — `/goal`

You are executing one phase of a 7-phase plan to deliver the **first paying Klimand Pro customer**. The product is solid; the gap is distribution and infrastructure. Done = **1 live Stripe subscription** with a delivered license key entitling a real Pro feature.

The Klimand tech roadmap lives in `/roadmap` (Phases A, B, D shipped; Phase C — plan/approve gate — is the only outstanding tech item and is bundled into Phase 4 of this plan).

## Phases (dependency order)

| # | Title | Depends on |
|---|---|---|
| 1 | Reserve assets (domains, npm, GitHub org) | — |
| 2 | Deploy Cloudflare + Stripe infrastructure | 1 |
| 3 | End-to-end checkout test (test mode → live mode) | 2 |
| 4 | Pre-launch polish (Phase C approve gate + demo GIF + analytics + copy lock) | 3 |
| 5 | Show HN + same-day cross-post to r/ClaudeAI + Twitter launch thread | 4 |
| 6 | Reddit follow-up (r/LocalLLaMA, r/programming) + build-in-public cadence | 5 |
| 7 | Conversion analysis → ship one targeted fix → repeat until 1 paid | 5 |

## Operating rules

1. **Execute exactly one phase per invocation.** Pick the lowest-numbered phase not yet shipped, or honor the user if they name one. State at the top of your response which phase you're about to run and why.
2. **Pause and ask before starting the next phase.** Exception: `/loop /goal` or explicit "chain through" — continue without asking (per memory `feedback_loop_chained_phases`).
3. **Real-world actions stop at the user.** Anything that costs money (domain registration, Stripe live-mode flip, actual HN/Reddit/Twitter post) is *prepared* by the phase and then handed to the user with a copy-paste-ready checklist. Don't post on the user's behalf. Don't spend the user's money without explicit per-action approval.
4. **Reuse existing assets — don't rebuild them:**
   - Landing page: `cloud/marketing/index.html`
   - Worker + license code: `cloud/worker/src/{license.ts,index.ts}`
   - Deploy spec: `cloud/README.md`
   - License paste page: `web/app/license/page.tsx`
   - Welcome onboarding: `web/app/welcome/page.tsx`
   - Ingest showpieces: `web/lib/ingest-{github,linear}.ts`
   - CLI entry: `cli/bin/klimand.mjs`
5. **Stop criterion.** Phase 7 keeps looping until Stripe shows ≥ 1 active subscription with a delivered license key. At that point `/goal` reports DONE — naming the customer, plan, and date — and pauses. Do not re-enter unless the user explicitly asks.

---

## Phase 1 — Reserve assets

**Goal:** Lock down the names so the launch can't be blocked by a squatter.

**Actions:**
- Check availability one last time: `klimand.com`, `klimand.dev`. Recommend Cloudflare Registrar (at-cost, no upsells). Hand the user the exact "buy now" links and rough cost (`.com` ~$10/yr, `.dev` ~$12/yr).
- Verify npm `klimand` is reserved. If the local CLI isn't ready for a real release yet, publish a `0.0.1-pre.1` placeholder from `cli/` with a README that just says "Klimand — coming soon. https://klimand.com". Owner-only access.
- Create GitHub org `klimand-dev` (bare `@klimand` is taken by an inactive user per memory). Reserve the org; don't move the repo yet unless the user asks.
- Set up `hello@klimand.com` forwarding alias (Cloudflare Email Routing → user's personal inbox). Needed for Stripe receipts, support, and license-key delivery.

**Deliverable (copy-paste checklist):**
- [ ] Bought `klimand.com` at Cloudflare Registrar
- [ ] Bought `klimand.dev` at Cloudflare Registrar
- [ ] `npm publish` of the stub from `cli/` succeeded (or chose to defer)
- [ ] GitHub org `klimand-dev` created
- [ ] `hello@klimand.com` forwarding alias active and tested

**Manual verification:** `whois klimand.com` shows user's registrar; `npm view klimand` returns owner = user; `gh api orgs/klimand-dev` returns 200.

---

## Phase 2 — Deploy Cloudflare + Stripe infrastructure

**Goal:** Boxes in `cloud/README.md` go from "NOT DEPLOYED" to "live, secrets set". After this phase: `https://klimand.com` renders the landing; `https://api.klimand.com/license/verify` is reachable. Checkout still test-mode.

**Actions:**
- Stand up Cloudflare Pages from `cloud/marketing/` with custom domain `klimand.com`. Confirm the page renders.
- Deploy `cloud/worker/` to Cloudflare Workers as `klimand-worker`. Custom route `api.klimand.com/*`. Bind KV namespace `KLIMAND_KV`. Set secrets: `STRIPE_SECRET_KEY` (test mode), `STRIPE_WEBHOOK_SECRET`. Confirm the Worker boots.
- Create Stripe products (**test mode**): `Klimand Pro Monthly $14`, `Klimand Pro Yearly $144`. Capture both Price IDs.
- Create Stripe Customer Portal config (test mode): allow plan switching M ↔ Y, allow cancel.
- Create Stripe webhook → `https://api.klimand.com/stripe/webhook` listening to `customer.subscription.{created,updated,deleted}` and `checkout.session.completed`.
- Set up Resend (or Cloudflare Email Worker) for license-key delivery. Template: "Your Klimand Pro license key: `klmd_…`. Paste it at https://klimand.com/license to activate."
- **Pick one real Pro feature to gate. Recommendation: hosted scheduling** — Worker Cron Trigger runs the user's schedules on Cloudflare instead of needing their machine awake. Already designed in `cloud/`. Smallest credible scope, immediate solo-dev value. Wire entitlement check: schedule-create API rejects unless `verifyLicense(key)` returns active.
- Update `web/app/license/page.tsx` and the upgrade CTA to set `CHECKOUT_URL` to the Stripe Checkout link (test mode).

**Files touched:**
- `cloud/worker/src/license.ts` — add email-delivery hook on `checkout.session.completed`
- `cloud/worker/src/index.ts` — wire the cron trigger handler that runs Pro users' schedules
- `cloud/marketing/index.html` — replace "Coming later" Pro pill with real $14/$144 pricing + Checkout buttons
- `web/app/license/page.tsx` — set `CHECKOUT_URL`, unhide upgrade CTA
- `web/app/api/schedules/route.ts` — add `verifyLicense` gate on the Pro-only path (host-on-cloud schedules); keep local-only schedules free
- New: `cloud/worker/src/email.ts` — Resend wrapper

**Manual verification:**
- `curl https://klimand.com` returns 200 with the landing HTML
- `curl https://api.klimand.com/license/verify?key=fake` returns 404
- Stripe dashboard (test mode) shows 2 prices, 1 webhook, 1 customer-portal config
- `wrangler tail klimand-worker` shows traffic when curling
- Sending a fake `checkout.session.completed` via Stripe CLI mints a `klmd_…` key in KV and queues an email send

---

## Phase 3 — End-to-end checkout test (test mode → live mode)

**Goal:** Walk a real human through landing → Upgrade → Stripe Checkout (test card) → webhook fires → license key emailed → paste at `/license` → Pro feature unlocks. Then flip Stripe to live mode and do it once with the user's own card.

**Actions:**
- Walk test-mode with `4242 4242 4242 4242`. Screenshot every step. Note friction (form fields, copy, error states) and fix immediately.
- Edge cases: cancelled subscription → license expires on next 24h cache refresh; failed payment → email mentions retry; switch monthly ↔ yearly via portal works.
- Flip Stripe to live mode. Recreate products + prices in live mode. Update Worker secret `STRIPE_SECRET_KEY` to live. Recreate webhook with live signing secret.
- User does **one** real $14 transaction with their own card to prove the live pipe. Refund themselves via Stripe dashboard afterwards.
- Update landing CTAs to point at the live Checkout URLs.

**Deliverable:**
- [ ] Test-mode checkout completes; license email arrives; `/license` activates Pro feature
- [ ] Stripe switched to live mode; products + webhook + signing secret recreated
- [ ] Self-test live transaction succeeded; refunded; live checkout URLs wired

**Manual verification:** Stripe live mode shows 1 succeeded payment + 1 refund + 1 active sub (then cancel). KV shows the `klmd_…` key for the live customer. Hosted-schedule API accepts the live key and rejects a fake key.

---

## Phase 4 — Pre-launch polish

**Goal:** No fixable embarrassment ships to HN. Three sub-tasks.

**4a. Phase C from `/roadmap` — plan/approve gate.** Execute verbatim from `c:\agents\CodexCLIAgent\.claude\commands\roadmap.md` Phase C. Files: `web/lib/prefs.ts`, new `web/lib/approval-broker.ts`, `web/lib/cli-tools.ts`, new `web/app/api/approvals/[callId]/route.ts`, `web/components/tool-ui/terminal/terminal.tsx`, `web/components/agent-profile-panel.tsx`. Verification: per the roadmap recipe.

**4b. Demo GIF.** Record ~30s of the killer flow: `npx klimand` → discovery scanner approves a real project → user types "review the diff on PR #N in this repo and suggest improvements" → tool card shows Claude Code working → result streams → orchestrator's one-sentence summary. Compress to <5 MB. Embed in the landing hero, replacing the static terminal cards.

**4c. Copy + analytics lock.** Final landing pass: real pricing visible (not "Coming later"), 3-bullet "Why solo devs", FAQ:
- *"Why do I need an OpenAI key?"* — Klimand routes locally. Your keys, your usage, your control.
- *"What's the difference between free and Pro?"* — Pro hosts your schedules in the cloud + push notifications + GitHub-backed sync.
- *"Can I cancel?"* — Yes, via the Stripe portal link in your license email.
- *"Do you store my prompts?"* — No. Routing data only.

Add Plausible (or Cloudflare Web Analytics) snippet. Tag events: `landing_view`, `pricing_click`, `checkout_start`, `checkout_complete`, `license_activated`.

**Files touched:**
- Phase C files (see `/roadmap`)
- `cloud/marketing/index.html` — replace hero, add FAQ, embed GIF, analytics snippet
- `cloud/marketing/assets/demo.mp4` (or `.gif`) — new
- `web/app/page.tsx` and welcome flow — emit analytics events on `pricing_click` / `license_activated` if reachable

**Manual verification:**
- Phase C recipe: set approval=ask, edit-and-approve a Codex prompt, reject another, exit 0 with notes
- Demo GIF plays within 2 s of page load
- Analytics dashboard records a test session with all 5 events firing in order

---

## Phase 5 — Launch day (Show HN + r/ClaudeAI + Twitter)

**Goal:** Coordinated push. Show HN headlines; Reddit and Twitter amplify same-day.

**Actions (preparation only; user posts):**
- Pick a Tuesday, Wednesday, or Thursday morning (8–10 am ET). Skip US holidays. Skip days with major Anthropic/OpenAI launches.
- Draft **Show HN title**: `Show HN: Klimand – local CLI orchestrator that delegates to Claude Code and Codex`. Hand to user for tweaks.
- Draft **Show HN body** (<1500 chars, no markdown, no emoji). Structure: what it is (one line) → why I built it (one para; solo-dev framing) → how it works (one para; gpt-5.4-mini routes, Claude/Codex execute, BYOK) → free vs Pro ($14/mo) → installation (`npx klimand`) → repo link → live link → "Happy to answer anything."
- Draft **r/ClaudeAI post**: title `Built a local orchestrator that delegates to Claude Code + Codex — open source`. Two paragraphs + demo GIF link. Mention GitHub PR ingest as the killer flow.
- Draft **Twitter launch thread** (5–7 tweets): hook + GIF → problem → solution → free vs Pro → live link → ask-for-feedback.
- Pre-arrange 3–5 friendlies in the user's network for *real* engagement on the HN thread in the first hour — no upvote rings. DM template: "Hey, Klimand is going up on HN at 9 am ET on <date> — would love a thoughtful comment if you have time."
- **Pre-flight checklist** (paste into the phase output):
  - [ ] `klimand.com` loads <2 s on cold cache
  - [ ] Test-mode checkout works one more time on a different browser
  - [ ] Repo README updated with the live URL and a screenshot
  - [ ] Stripe dashboard tab pinned for monitoring
  - [ ] Plausible / CF Analytics dashboard pinned for monitoring
  - [ ] HN draft pasted into `news.ycombinator.com/submit` (don't hit submit yet)
  - [ ] r/ClaudeAI post staged in another tab
  - [ ] Twitter thread staged in TweetDeck or buffer
  - [ ] Phone next to keyboard for the next 6 hours

**Deliverable:** User hits submit on HN. Assistant stays open in a side window for the next 4 hours, drafting replies to HN/Reddit comments for the user to post.

**Manual verification:**
- HN post visible at `news.ycombinator.com/show` (any rank — front page in 2 hours is a win)
- Analytics shows >100 `landing_view` events in the first hour
- At least 1 `checkout_start` event

---

## Phase 6 — Reddit follow-up + build-in-public cadence

**Goal:** Tail traffic from launch day → sustained drip.

**Actions:**
- ~5–7 days after HN, post to r/LocalLLaMA with a fresh framing: emphasize OSS-local, BYOK, no telemetry. Title: `Klimand — local LLM orchestrator that routes between Claude Code and Codex (open source, BYOK)`.
- ~10–14 days later, post to r/programming with the broadest framing: `Show /r/programming: A local CLI orchestrator for solo developers`.
- Twitter cadence: 2 build-in-public tweets per week. Rotating topics:
  - User-observed behavior anecdote
  - Small feature shipped + GIF
  - One Pro perk explained (hosted scheduling, GitHub sync, etc.)
  - Roadmap teaser (no commitments)
- Each tweet: phase produces draft + asset suggestion; user posts.

**Deliverable:** Drafts ready for next 2 weeks of posts; first Reddit follow-up posted.

**Manual verification:** Cumulative `landing_view` events ≥ 1000 within 2 weeks of HN.

---

## Phase 7 — Conversion analysis → targeted fix → repeat until 1 paid

**Goal:** Loop. Each invocation: pull funnel numbers, identify the biggest drop, ship one targeted fix, exit. Re-enter via `/loop` (e.g. `/loop 6h /goal`). Stops at ≥ 1 active Stripe subscription.

**Each invocation:**

1. Pull analytics for last 24 h / 7 d:
   - `landing_view → pricing_click` (target >30%)
   - `pricing_click → checkout_start` (target >50%)
   - `checkout_start → checkout_complete` (target >40%)
   - `checkout_complete → license_activated` (target >80%)
   Use the PostHog `exec` MCP tool (project 380637) if events are wired there, otherwise Plausible / CF Web Analytics.
2. Identify the biggest %-point gap vs target.
3. Form one specific hypothesis (e.g. *"Pricing copy is buried — moving Pro pricing above the fold should lift `landing_view → pricing_click`"*).
4. Ship one small diff. Verify the rendered output.
5. Wait 24–48 h (or until next `/loop` tick) before re-measuring; don't re-test before enough events accumulate.
6. Report: what was the drop, what shipped, what's next.

**Stop check (every invocation):**
```js
stripe.subscriptions.list({ status: "active" }).data.length >= 1
```
If true → report DONE (customer, plan, date) → exit. Do not re-enter unless the user explicitly asks.

---

## Out of scope (do NOT do inside `/goal`)

- Team tier, multi-seat licenses, SSO
- Native mobile (iOS/Android)
- Hosted Claude Code / Codex execution (blows cloud-cost budget)
- Multi-CLI parallel runs / diff mode
- Cost / usage dashboards inside the app
- Native push notifications (APNs/FCM) — Web Push only
- Klimand-as-MCP-server
- Cold outbound (cold emails, DMs to strangers); warm-network DMs only, and only the user sends them
- Paid ads
