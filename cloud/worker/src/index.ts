// Klimand Cloudflare Worker — single endpoint serving:
//   - license/issue       (Stripe webhook → mint license)
//   - license/verify      (local app polls)
//   - push/subscribe      (browser registers Web Push)
//   - push/send           (server fan-out)
//   - llm/chat            (hosted LLM gateway with per-license token cap)
// + cron tick that fires hosted schedules.

import type {
  ExecutionContext,
  KVNamespace,
  ScheduledEvent
} from "@cloudflare/workers-types";

import {
  handleLicenseIssue,
  handleLicenseVerify,
  handleCustomerPortal
} from "./license";
import { handlePushSubscribe, handlePushTest } from "./push";
import { handleLLMChat } from "./llm";
import { tickSchedules } from "./schedules";

export interface Env {
  KLIMAND_KV: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRO_PRICE_ID: string;
  STRIPE_PRO_PRICE_ID_YEARLY?: string;
  OPENAI_API_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_CONTACT: string;
  RESEND_API_KEY?: string;
  LICENSE_FROM_EMAIL?: string;
  STRIPE_PORTAL_CONFIG_ID?: string;
}

function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-headers", "content-type,authorization,x-license-key");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    try {
      if (req.method === "POST" && path === "/license/issue") return cors(await handleLicenseIssue(req, env));
      if (req.method === "GET" && path === "/license/verify") return cors(await handleLicenseVerify(req, env));
      if (req.method === "POST" && path === "/license/portal") return cors(await handleCustomerPortal(req, env));
      if (req.method === "POST" && path === "/push/subscribe") return cors(await handlePushSubscribe(req, env));
      if (req.method === "POST" && path === "/push/test") return cors(await handlePushTest(req, env));
      if (req.method === "POST" && path === "/llm/chat") return cors(await handleLLMChat(req, env, ctx));
      if (req.method === "GET" && path === "/health") return cors(new Response("ok"));
      return cors(new Response("not found", { status: 404 }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return cors(new Response(JSON.stringify({ error: "internal", message: msg }), { status: 500, headers: { "content-type": "application/json" } }));
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tickSchedules(env, event.scheduledTime));
  }
};
