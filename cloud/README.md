# cloud/

Hosted services for **Klimand Pro**. Intended closed-source when deployed; the reference implementation in this repo ships Apache-2.0 for transparency.

**Status (2026-05-17):**
- ✅ `marketing/` — landing site live at https://klimand.com (Cloudflare Pages)
- ⏳ `worker/` — code complete, **not yet deployed** to `api.klimand.com`

Two artifacts here:

- `worker/` — Cloudflare Worker that handles license verification, hosted scheduling cron, Web Push fan-out, the optional hosted LLM gateway, and license-key email delivery via Resend.
- `marketing/` — Cloudflare Pages static site (already deployed to `klimand.com`) — landing, pricing, docs.

## Deploy the Worker (one-time setup)

You need: a Cloudflare account, a Stripe account, a Resend account, the `klimand.com` domain on Cloudflare DNS (already set up).

```bash
cd cloud/worker
npm install

# 1. Create KV namespace and put the returned ID into wrangler.toml
npx wrangler kv namespace create KLIMAND_KV
# → copy the printed id into wrangler.toml's [[kv_namespaces]] block

# 2. Set required secrets
npx wrangler secret put STRIPE_SECRET_KEY            # sk_test_... initially
npx wrangler secret put STRIPE_WEBHOOK_SECRET        # whsec_... (from the webhook you create in Stripe in step 4)
npx wrangler secret put STRIPE_PRO_PRICE_ID          # price_... monthly (from step 4)
npx wrangler secret put STRIPE_PRO_PRICE_ID_YEARLY   # price_... annual (optional, from step 4)
npx wrangler secret put RESEND_API_KEY               # re_... from resend.com
npx wrangler secret put LICENSE_FROM_EMAIL           # e.g. "Klimand <support@klimand.com>"

# 3. (Optional, push notifications) Generate + set VAPID keys
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY             # paste public
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_CONTACT                # mailto:support@klimand.com

# 4. (Optional, hosted LLM gateway) Set OpenAI key for Pro routing
npx wrangler secret put OPENAI_API_KEY

# 5. Deploy
npx wrangler deploy
```

After `wrangler deploy`, the Worker is reachable at `https://klimand.<account>.workers.dev`. To expose it as `https://api.klimand.com`:

```
Cloudflare Dashboard → klimand.com → Workers Routes → Add route
  Route:   api.klimand.com/*
  Worker:  klimand
  Zone:    klimand.com
```

You may also need to add a CNAME record `api → klimand.<account>.workers.dev` in DNS (or just use the Workers Routes UI which handles the routing without touching DNS).

## Stripe setup (in the Stripe dashboard)

1. **Products** — create one product "Klimand Pro" with two recurring prices:
   - $14/mo (USD)  → `STRIPE_PRO_PRICE_ID`
   - $144/yr (USD) → `STRIPE_PRO_PRICE_ID_YEARLY`
2. **Customer Portal** — enable; allow plan switching (monthly ↔ yearly) and cancel.
3. **Webhook** — endpoint `https://api.klimand.com/license/issue`, listening to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   Capture the signing secret (`whsec_…`) and put it as `STRIPE_WEBHOOK_SECRET`.
4. **Payment Link** — create a hosted Payment Link for each price. Capture the URLs; these go in `cloud/marketing/index.html` as the Upgrade CTAs, and in the local web app as `NEXT_PUBLIC_KLIMAND_CHECKOUT_URL`.

## Local app config

Once the Worker is live, set in the local web app's environment so it knows where to verify licenses:

```bash
KLIMAND_CLOUD_BASE=https://api.klimand.com
NEXT_PUBLIC_KLIMAND_CHECKOUT_URL=<your Stripe Payment Link>
```

With those set, `web/app/license/page.tsx` shows the "Subscribe to Pro" CTA and `web/lib/license.ts` calls `/license/verify` on the Worker.

## Cost envelope

- Cloudflare Workers + KV + Pages: free tier covers <100K req/day.
- Resend: free tier covers 3,000 emails/month and 100/day — comfortable headroom for license delivery.
- Stripe: 2.9% + $0.30 per transaction; no monthly fee.
- Domain (`klimand.com`): ~$10/yr.
- Hosted LLM gateway: per-license token cap of 130K/mo (~$0.30 at gpt-5.4-mini rates).
- Steady state at 100 paid subs: ~$5/mo + tokens.

## License-key email path

When Stripe fires `customer.subscription.created`:

1. Worker verifies the signature, mints `klmd_<uuid27>`, stores `license:<key>` and `subindex:<sub.id>` in KV.
2. Looks up the customer's email via the Stripe API.
3. Creates a Customer Portal session URL (return URL: `https://klimand.com/license`).
4. Calls Resend with the license key + portal URL.

If `RESEND_API_KEY` or `LICENSE_FROM_EMAIL` is unset, the email step soft-fails — the key is still in KV and the user can recover it via the Customer Portal redirect. See `worker/src/email.ts`.
