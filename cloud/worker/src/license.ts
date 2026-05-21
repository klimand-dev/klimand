// License key issuance + verification, backed by Stripe-as-source-of-truth.
//
// Issuance: Stripe webhook on `customer.subscription.created` (or `.updated`)
// fires here. We generate a license key, store mapping in KV, and email the
// customer the key via Resend (RESEND_API_KEY + LICENSE_FROM_EMAIL secrets;
// if unset, the issuance still succeeds and the key is recoverable via the
// Customer Portal flow — see sendLicenseEmail soft-fail behavior).
//
// Verification: the local app calls /license/verify?key=... once per 24h.
// Worker re-checks Stripe subscription status and refreshes KV. Local app
// caches the result.

import Stripe from "stripe";
import type { Env } from "./index";
import { sendLicenseEmail } from "./email";

interface LicenseRecord {
  stripeSubId: string;
  customerId: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid";
  currentPeriodEnd: number; // unix ms
  llmTokensThisMonth?: number;
  monthBucket?: string; // YYYY-MM
}

function stripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });
}

function newLicenseKey(): string {
  // 32 chars, base32-ish from crypto.randomUUID + a short prefix.
  return "klmd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 27);
}

function licenseKey(k: string): string {
  return `license:${k}`;
}

function subIndex(subId: string): string {
  return `subindex:${subId}`;
}

export async function handleLicenseIssue(req: Request, env: Env): Promise<Response> {
  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();
  const s = stripe(env);
  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`webhook signature: ${(e as Error).message}`, { status: 400 });
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const status = sub.status as LicenseRecord["status"];
    // Find or mint a license for this subscription.
    let key = await env.KLIMAND_KV.get(subIndex(sub.id));
    const isNewLicense = !key;
    if (!key) {
      key = newLicenseKey();
      await env.KLIMAND_KV.put(subIndex(sub.id), key);
    }
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const rec: LicenseRecord = {
      stripeSubId: sub.id,
      customerId,
      status,
      currentPeriodEnd: (sub.current_period_end ?? 0) * 1000
    };
    await env.KLIMAND_KV.put(licenseKey(key), JSON.stringify(rec));

    // On first issuance, email the key to the customer. Soft-fail.
    if (isNewLicense && event.type === "customer.subscription.created") {
      try {
        const s = stripe(env);
        const customer = await s.customers.retrieve(customerId);
        const to = !("deleted" in customer) && customer.email ? customer.email : null;
        if (to) {
          const interval = sub.items.data[0]?.price?.recurring?.interval;
          const plan: "monthly" | "yearly" = interval === "year" ? "yearly" : "monthly";
          const portal = await s.billingPortal.sessions.create({
            customer: customerId,
            return_url: "https://klimand.com/license",
            ...(env.STRIPE_PORTAL_CONFIG_ID ? { configuration: env.STRIPE_PORTAL_CONFIG_ID } : {})
          }).catch(() => null);
          await sendLicenseEmail(env, { to, licenseKey: key, plan, portalUrl: portal?.url });
        } else {
          console.warn(`[license/issue] no customer email for sub ${sub.id}; skipping send`);
        }
      } catch (e) {
        console.error(`[license/issue] email path failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return Response.json({ ok: true, licenseKey: key, status });
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const key = await env.KLIMAND_KV.get(subIndex(sub.id));
    if (key) {
      const cur = await env.KLIMAND_KV.get<LicenseRecord>(licenseKey(key), "json");
      if (cur) {
        cur.status = "canceled";
        await env.KLIMAND_KV.put(licenseKey(key), JSON.stringify(cur));
      }
    }
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true, ignored: event.type });
}

export async function handleLicenseVerify(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("x-license-key") ?? "";
  if (!key) return Response.json({ error: "missing_key" }, { status: 400 });
  const rec = await env.KLIMAND_KV.get<LicenseRecord>(licenseKey(key), "json");
  if (!rec) return Response.json({ status: "unknown" }, { status: 404 });

  // Re-check Stripe so cancellations propagate within ~24h regardless of webhook reliability.
  try {
    const s = stripe(env);
    const sub = await s.subscriptions.retrieve(rec.stripeSubId);
    rec.status = sub.status as LicenseRecord["status"];
    rec.currentPeriodEnd = (sub.current_period_end ?? 0) * 1000;
    await env.KLIMAND_KV.put(licenseKey(key), JSON.stringify(rec));
  } catch {
    /* if Stripe is unreachable, fall back to cached value */
  }

  const active = rec.status === "active" || rec.status === "trialing";
  return Response.json({
    status: active ? "active" : rec.status,
    currentPeriodEnd: rec.currentPeriodEnd
  });
}

export async function handleCustomerPortal(req: Request, env: Env): Promise<Response> {
  const { licenseKey: key, returnUrl } = (await req.json()) as { licenseKey?: string; returnUrl?: string };
  if (!key) return Response.json({ error: "missing_key" }, { status: 400 });
  const rec = await env.KLIMAND_KV.get<LicenseRecord>(licenseKey(key), "json");
  if (!rec) return Response.json({ error: "unknown_license" }, { status: 404 });
  const s = stripe(env);
  const session = await s.billingPortal.sessions.create({
    customer: rec.customerId,
    return_url: returnUrl ?? "http://localhost:3000/license",
    ...(env.STRIPE_PORTAL_CONFIG_ID ? { configuration: env.STRIPE_PORTAL_CONFIG_ID } : {})
  });
  return Response.json({ url: session.url });
}

export async function getLicenseForKey(env: Env, key: string): Promise<LicenseRecord | null> {
  if (!key) return null;
  return env.KLIMAND_KV.get<LicenseRecord>(licenseKey(key), "json");
}

export async function bumpLicenseTokens(env: Env, key: string, deltaTokens: number): Promise<LicenseRecord | null> {
  const rec = await env.KLIMAND_KV.get<LicenseRecord>(licenseKey(key), "json");
  if (!rec) return null;
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (rec.monthBucket !== bucket) {
    rec.monthBucket = bucket;
    rec.llmTokensThisMonth = 0;
  }
  rec.llmTokensThisMonth = (rec.llmTokensThisMonth ?? 0) + deltaTokens;
  await env.KLIMAND_KV.put(licenseKey(key), JSON.stringify(rec));
  return rec;
}

export { type LicenseRecord };
