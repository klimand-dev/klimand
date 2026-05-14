"use client";

// Web Push registration. Subscribes the browser to push, sends the
// subscription to the cloud Worker so it can fan out scheduled-run alerts.
//
// Pro-only: callers should gate with useLicense().isPro.

// The cloud surface is not deployed by default. Set
// NEXT_PUBLIC_KLIMAND_CLOUD_BASE at build time to point at your own
// Cloudflare Worker before Pro features can do anything useful.
const CLOUD_BASE =
  (typeof window !== "undefined" && (window as unknown as { __KLIMAND_CLOUD_BASE__?: string }).__KLIMAND_CLOUD_BASE__) ||
  process.env.NEXT_PUBLIC_KLIMAND_CLOUD_BASE ||
  "";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_KLIMAND_VAPID_PUBLIC ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensurePushReady(licenseKey: string): Promise<{ ok: boolean; reason?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "browser does not support Web Push" };
  }
  if (!CLOUD_BASE) {
    return { ok: false, reason: "cloud backend not deployed (NEXT_PUBLIC_KLIMAND_CLOUD_BASE unset)" };
  }
  if (!VAPID_PUBLIC) {
    return { ok: false, reason: "VAPID public key not configured in build" };
  }
  if (!licenseKey) {
    return { ok: false, reason: "Pro license required" };
  }
  try {
    const reg = await navigator.serviceWorker.register("/klimand-sw.js");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return { ok: false, reason: "notification permission denied" };
      const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer
      });
    }
    const subscription = sub.toJSON();
    const res = await fetch(`${CLOUD_BASE}/push/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey, subscription })
    });
    if (!res.ok) return { ok: false, reason: `cloud subscribe ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendTestPush(licenseKey: string): Promise<boolean> {
  if (!CLOUD_BASE) return false;
  try {
    const res = await fetch(`${CLOUD_BASE}/push/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey })
    });
    return res.ok;
  } catch {
    return false;
  }
}
