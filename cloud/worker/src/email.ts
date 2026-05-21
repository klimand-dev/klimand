// Resend wrapper. Sends the freshly-minted license key to the Stripe customer
// after a successful subscription.created webhook. Soft-fails: if Resend is
// unconfigured or returns an error, we log to console and continue — the key
// is still in KV and the user can recover it via the Customer Portal flow.

import type { Env } from "./index";

interface SendLicenseEmailArgs {
  to: string;
  licenseKey: string;
  plan: "monthly" | "yearly";
  portalUrl?: string;
}

const ACTIVATE_URL = "https://klimand.com/license";

export async function sendLicenseEmail(env: Env, args: SendLicenseEmailArgs): Promise<void> {
  if (!env.RESEND_API_KEY || !env.LICENSE_FROM_EMAIL) {
    console.log("[email] skipping send — RESEND_API_KEY or LICENSE_FROM_EMAIL not set");
    return;
  }
  const planLabel = args.plan === "yearly" ? "Klimand Pro (annual)" : "Klimand Pro (monthly)";
  const html = renderHtml({ ...args, planLabel });
  const text = renderText({ ...args, planLabel });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: env.LICENSE_FROM_EMAIL,
        to: args.to,
        subject: "Your Klimand Pro license key",
        html,
        text
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] resend ${res.status}: ${body}`);
    }
  } catch (e) {
    console.error(`[email] send failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function renderText(a: { licenseKey: string; planLabel: string; portalUrl?: string }): string {
  return [
    `Thanks for subscribing to ${a.planLabel}.`,
    ``,
    `Your license key:`,
    `  ${a.licenseKey}`,
    ``,
    `Activate it in Klimand by pasting it at:`,
    `  ${ACTIVATE_URL}`,
    ``,
    a.portalUrl ? `Manage your subscription (cancel, switch plan, update card):\n  ${a.portalUrl}\n` : ``,
    `Questions? Reply to this email.`
  ].filter(Boolean).join("\n");
}

function renderHtml(a: { licenseKey: string; planLabel: string; portalUrl?: string }): string {
  const portalLine = a.portalUrl
    ? `<p style="margin:24px 0 0 0;font-size:13px;color:#6b7280">Manage your subscription (cancel, switch plan, update card): <a href="${escapeHtml(a.portalUrl)}">Customer portal</a></p>`
    : ``;
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f8fa;margin:0;padding:24px;color:#0b0d12">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 8px 0;font-size:20px">Thanks for subscribing to ${escapeHtml(a.planLabel)}.</h1>
    <p style="margin:0 0 24px 0;color:#4b5563">Here's your license key.</p>
    <pre style="background:#0b0d12;color:#6ad6c8;padding:16px;border-radius:8px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:14px;overflow-x:auto;margin:0">${escapeHtml(a.licenseKey)}</pre>
    <p style="margin:24px 0 0 0">Activate it in Klimand: <a href="${ACTIVATE_URL}" style="color:#6ad6c8">${ACTIVATE_URL}</a></p>
    ${portalLine}
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280">Questions? Reply to this email.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
