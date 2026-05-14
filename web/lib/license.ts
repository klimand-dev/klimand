import { getPrefs, setPrefs } from "./prefs";

// The Pro cloud surface (license verification, hosted scheduling, push, LLM
// gateway) is NOT deployed by default. To enable it, deploy `cloud/worker/`
// to your own Cloudflare account and set KLIMAND_CLOUD_BASE to the
// resulting Worker URL. With no env var set, all Pro endpoints short-circuit
// to "unknown" / disabled so the local app still works as a free OSS tool.
const CLOUD_BASE = process.env.KLIMAND_CLOUD_BASE ?? "";
const VERIFY_CACHE_MS = 24 * 60 * 60 * 1000;

export type LicenseStatus = "active" | "trial" | "expired" | "unknown";

export interface LicenseState {
  key: string | null;
  status: LicenseStatus;
  verifiedAt: string | null;
  isPro: boolean;
}

export async function getLicenseState(): Promise<LicenseState> {
  const prefs = await getPrefs();
  const key = prefs.license?.key ?? null;
  const verifiedAt = prefs.license?.verifiedAt ?? null;
  const status = (prefs.license?.status ?? "unknown") as LicenseStatus;
  return { key, status, verifiedAt, isPro: status === "active" || status === "trial" };
}

export async function verifyLicense(force = false): Promise<LicenseState> {
  const prefs = await getPrefs();
  const key = prefs.license?.key;
  if (!key) return { key: null, status: "unknown", verifiedAt: null, isPro: false };

  // 24h cache unless force=true.
  if (!force && prefs.license?.verifiedAt) {
    const age = Date.now() - new Date(prefs.license.verifiedAt).getTime();
    if (Number.isFinite(age) && age < VERIFY_CACHE_MS) {
      return getLicenseState();
    }
  }

  if (!CLOUD_BASE) {
    // No cloud endpoint configured. The stored key is opaque to us; treat as
    // "unknown" until the user wires up a backend.
    return getLicenseState();
  }

  try {
    const res = await fetch(`${CLOUD_BASE}/license/verify?key=${encodeURIComponent(key)}`);
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    let next: LicenseStatus = "unknown";
    if (data.status === "active") next = "active";
    else if (data.status === "trialing") next = "trial";
    else if (data.status === "canceled" || data.status === "incomplete" || data.status === "unpaid") next = "expired";
    else if (res.status === 404) next = "unknown";
    await setPrefs({ license: { key, status: next, verifiedAt: new Date().toISOString() } });
    return { key, status: next, verifiedAt: new Date().toISOString(), isPro: next === "active" || next === "trial" };
  } catch {
    // Offline: keep the cached status; don't lock the user out on a transient network blip.
    return getLicenseState();
  }
}

export async function setLicenseKey(key: string | null): Promise<LicenseState> {
  await setPrefs({
    license: {
      key: key ?? undefined,
      status: key ? "unknown" : undefined,
      verifiedAt: undefined
    }
  });
  if (key) return verifyLicense(true);
  return { key: null, status: "unknown", verifiedAt: null, isPro: false };
}
