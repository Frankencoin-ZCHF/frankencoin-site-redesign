/*
 * POST /api/hit — anonymous page-view counter that needs no consent banner.
 *
 * Why: the main Google Analytics tag only records visitors who accept cookies (about one in ten), so it cannot
 * tell us how many people visit. The page script in layouts/Base.astro sends one small beacon per page view
 * here, and this endpoint forwards it to a separate GA4 property ("Frankencoin Website - cookieless totals").
 *
 * What is forwarded: page path, utm_* parameters, the referring site's origin, page title, language, screen
 * size and browser type. What is not: no cookie, no stored identifier, no IP address (Google sees this
 * server's address, not the visitor's). Every hit gets a fresh random client id, so the property counts
 * page views and where they come from, not unique people.
 */
import type { APIRoute } from "astro";

export const prerender = false;

const TID = "G-G0F5VDWNKS";
const HOSTS = new Set(["frankencoin.com", "www.frankencoin.com"]);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl|wget|python|node|axios|postman/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export const POST: APIRoute = async ({ request }) => {
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    const ua = request.headers.get("user-agent") ?? "";
    const origin = new URL(request.headers.get("origin") ?? "http://invalid");
    // Count production only: previews and local runs would otherwise pollute the totals. FC_HIT_TEST=1 lets
    // a local server send test hits.
    if (!HOSTS.has(origin.hostname) && process.env.FC_HIT_TEST !== "1") return done;
    if (!ua || BOT.test(ua)) return done;

    const b = JSON.parse((await request.text()).slice(0, 2000));
    const path = clip(b.p, 300);
    if (!path.startsWith("/")) return done;
    const utm = clip(b.q, 300).split("&").filter((x) => /^utm_(source|medium|campaign|content|term)=[^=]*$/.test(x)).join("&");
    let ref = "";
    try { ref = new URL(clip(b.r, 200)).origin + "/"; } catch {}

    const now = Math.floor(Date.now() / 1000);
    const rand = Math.floor(Math.random() * 2 ** 31);
    const q = new URLSearchParams({
      v: "2", tid: TID, cid: `${rand}.${now}`, sid: String(now), sct: "1", seg: "0", _p: String(rand), _s: "1",
      _ss: "1", _fv: "1", _nsi: "1",
      en: "page_view",
      dl: `https://frankencoin.com${path}${utm ? `?${utm}` : ""}`,
      dt: clip(b.t, 150),
      ul: clip(b.l, 12).toLowerCase(),
      sr: /^\d{2,5}x\d{2,5}$/.test(b.w) ? b.w : "",
      // 1 when the visitor arrived from outside the site (or typed the address), 0 for a click within it.
      "epn.entry": b.e ? "1" : "0",
    });
    if (ref) q.set("dr", ref);
    await fetch(`https://www.google-analytics.com/g/collect?${q}`, { method: "POST", headers: { "User-Agent": ua }, signal: AbortSignal.timeout(3000) });
  } catch {
    // Counting must never break a page view.
  }
  return done;
};
