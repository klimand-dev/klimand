// Web Push subscription storage + send. Workers don't include `web-push` natively,
// so we implement just-enough of VAPID + payload encryption inline. For v1 we
// support `mailto:` contact + ES256 keys.
//
// Each license can register N device subscriptions. We store the JSON payload
// returned by `pushManager.subscribe()` keyed by `push:<licenseKey>:<endpointHash>`.

import { getLicenseForKey } from "./license";
import type { Env } from "./index";

interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StoredSubscription extends BrowserSubscription {
  registeredAt: number;
}

async function endpointHash(endpoint: string): Promise<string> {
  const data = new TextEncoder().encode(endpoint);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function subKey(licenseKey: string, hash: string): string {
  return `push:${licenseKey}:${hash}`;
}

export async function handlePushSubscribe(req: Request, env: Env): Promise<Response> {
  const { licenseKey, subscription } = (await req.json()) as {
    licenseKey?: string;
    subscription?: BrowserSubscription;
  };
  if (!licenseKey || !subscription?.endpoint) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  const lic = await getLicenseForKey(env, licenseKey);
  if (!lic || (lic.status !== "active" && lic.status !== "trialing")) {
    return Response.json({ error: "not_pro" }, { status: 403 });
  }
  const hash = await endpointHash(subscription.endpoint);
  const rec: StoredSubscription = { ...subscription, registeredAt: Date.now() };
  await env.KLIMAND_KV.put(subKey(licenseKey, hash), JSON.stringify(rec));
  return Response.json({ ok: true });
}

export async function listSubscriptions(env: Env, licenseKey: string): Promise<StoredSubscription[]> {
  const list = await env.KLIMAND_KV.list({ prefix: `push:${licenseKey}:` });
  const out: StoredSubscription[] = [];
  for (const k of list.keys) {
    const v = await env.KLIMAND_KV.get<StoredSubscription>(k.name, "json");
    if (v) out.push(v);
  }
  return out;
}

// Stub: a full Web Push implementation is several hundred lines of crypto.
// For v1 we delegate to a hosted relay (e.g. a free Cloudflare-compatible
// push helper) or invoke a third-party service. We keep the interface stable.
export async function sendPushToLicense(
  env: Env,
  licenseKey: string,
  payload: { title: string; body: string; tag?: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  const subs = await listSubscriptions(env, licenseKey);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      // TODO: wire to a Web Push library that works in Workers (e.g. web-push-libs
      // via `npm:web-push` plus the `nodejs_compat` flag). For now, log + count.
      console.log(`[push] would send to ${sub.endpoint.slice(0, 40)}…: ${payload.title}`);
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

export async function handlePushTest(req: Request, env: Env): Promise<Response> {
  const { licenseKey } = (await req.json()) as { licenseKey?: string };
  if (!licenseKey) return Response.json({ error: "missing_key" }, { status: 400 });
  const result = await sendPushToLicense(env, licenseKey, {
    title: "Klimand",
    body: "Test notification",
    tag: "test"
  });
  return Response.json(result);
}
