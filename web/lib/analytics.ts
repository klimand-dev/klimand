"use client";

// Thin wrapper over PostHog so we can call `track('event', {...})` without
// caring whether the snippet has finished loading yet. No-op on the server.

type PostHog = {
  capture: (event: string, props?: Record<string, unknown>) => void;
  __SV?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var posthog: PostHog | undefined;
}

const PH_KEY = "phc_nDrXNnhGbKMxiAbgqtcF37fvo3vPMonUrkmakKezSMZP";
const PH_HOST = "https://us.i.posthog.com";

let initted = false;

function ensureLoaded(): void {
  if (typeof window === "undefined") return;
  if (initted) return;
  initted = true;
  // PostHog stub bootstrap. Same shape as the snippet on klimand.com so
  // calls before the real script lands queue instead of error.
  /* eslint-disable */
  (function (t: Document, e: any) {
    let o: any, n: any, p: any, r: any;
    if (e.__SV) return;
    (window as any).posthog = e;
    e._i = [];
    e.init = function (i: string, s: { api_host: string; defaults?: string }, a?: string) {
      function g(t: any, e: string) {
        const o = e.split(".");
        if (o.length === 2) {
          t = t[o[0]];
          e = o[1];
        }
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }
      p = t.createElement("script");
      p.type = "text/javascript";
      p.crossOrigin = "anonymous";
      p.async = true;
      p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
      r = t.getElementsByTagName("script")[0];
      r.parentNode.insertBefore(p, r);
      let u: any = e;
      if (a !== undefined) {
        u = e[a] = [];
      } else {
        a = "posthog";
      }
      u.people = u.people || [];
      u.toString = function (t?: boolean) {
        let e = "posthog";
        if (a !== "posthog") e += "." + a;
        if (!t) e += " (stub)";
        return e;
      };
      u.people.toString = function () {
        return u.toString(1) + ".people (stub)";
      };
      o = "init capture identify reset register register_once unregister".split(" ");
      for (n = 0; n < o.length; n++) g(u, o[n]);
      e._i.push([i, s, a]);
      e.__SV = 1;
    };
  })(document, (window as any).posthog || []);
  (window as any).posthog.init(PH_KEY, { api_host: PH_HOST, defaults: "2025-05-24" });
  /* eslint-enable */
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  ensureLoaded();
  try {
    window.posthog?.capture(event, props);
  } catch {
    /* no-op */
  }
}
