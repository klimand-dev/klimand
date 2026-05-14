# cloud/

> **Status: NOT DEPLOYED.** The code in this directory describes a hosted
> Pro tier that exists only as source. No domain (e.g. `klimand.dev` as
> referenced in some placeholder URLs) is currently registered or running.
> To stand it up yourself, follow the deploy steps below and substitute
> your own domain everywhere `klimand.dev` / `klimand.workers.dev`
> appears.

Hosted services for Klimand Pro (intended closed-source when deployed; the
reference implementation in this repo ships Apache-2.0 for transparency).

Two artifacts here:

- `worker/` — Cloudflare Worker that handles license verification, hosted
  scheduling cron, Web Push fan-out, and the optional hosted LLM gateway.
- `marketing/` — Cloudflare Pages static site (`klimand.dev`) — landing,
  pricing, docs, templates.

## Deploy

You need: a Cloudflare account (free), a Stripe account, a domain.

```bash
# Worker
cd cloud/worker
npm install
npx wrangler kv namespace create KLIMAND_KV
# Update wrangler.toml with the returned ID, then:
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRO_PRICE_ID
npx wrangler secret put OPENAI_API_KEY
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY    # paste public from above
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_CONTACT       # mailto:you@yourdomain.com
npx wrangler deploy

# Marketing site
cd ../marketing
npx wrangler pages deploy . --project-name klimand
```

In Stripe:
- Create a Product "Klimand Pro" with a $14/mo and $144/yr recurring
  Price. Copy each Price ID; configure the monthly one as `STRIPE_PRO_PRICE_ID`.
- Set up a webhook endpoint pointing at `https://<your-worker>.workers.dev/license/issue`
  subscribed to `customer.subscription.{created,updated,deleted}`.
- Use a Payment Link or Stripe Checkout (hosted) for the `/checkout` button on
  the marketing site.

## Cost envelope

- Cloudflare Workers + KV + Pages: free tier covers <100K req/day.
- Stripe: 2.9% + $0.30 per transaction; no monthly fee.
- Domain: ~$12/yr.
- Hosted LLM gateway: per-license token cap of 130K/mo (~$0.30 at gpt-5.4-mini rates).
- Steady state at 100 paid subs: ~$5/mo + tokens.
