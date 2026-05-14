// Hosted LLM gateway. Pro users flip a toggle in the local app and orchestrator
// calls route here instead of using their own pasted key.
//
// Cap: ~130K tokens/month (~$0.30 of gpt-5.4-mini equivalent traffic).
// Once exceeded, returns 429 with a clear message; the local app falls back
// to BYOK if available.

import type { ExecutionContext } from "@cloudflare/workers-types";
import { getLicenseForKey, bumpLicenseTokens } from "./license";
import type { Env } from "./index";

const MONTHLY_TOKEN_CAP = 130_000;

interface ChatRequest {
  licenseKey: string;
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export async function handleLLMChat(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await req.json()) as ChatRequest;
  if (!body.licenseKey) return Response.json({ error: "missing_license" }, { status: 401 });
  const lic = await getLicenseForKey(env, body.licenseKey);
  if (!lic || (lic.status !== "active" && lic.status !== "trialing")) {
    return Response.json({ error: "not_pro" }, { status: 403 });
  }

  // Reset bucket on month rollover via bumpLicenseTokens, but pre-check with cached counter.
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const used = lic.monthBucket === bucket ? lic.llmTokensThisMonth ?? 0 : 0;
  if (used >= MONTHLY_TOKEN_CAP) {
    return Response.json(
      {
        error: "quota_exceeded",
        message: "Monthly hosted-LLM token quota exceeded. Switch to your own API key in Settings → BYOK to continue.",
        used,
        cap: MONTHLY_TOKEN_CAP
      },
      { status: 429 }
    );
  }

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: body.model ?? "gpt-5.4-mini",
      messages: body.messages,
      max_tokens: body.max_tokens,
      temperature: body.temperature
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });
  }

  const data = (await upstream.json()) as { usage?: UpstreamUsage };
  const tokens = data.usage?.total_tokens ?? 0;
  ctx.waitUntil(bumpLicenseTokens(env, body.licenseKey, tokens).then(() => undefined));
  return Response.json(data);
}
