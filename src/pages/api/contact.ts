/**
 * POST /api/contact — the website contact form.
 *
 * Sends the message to the Association's inbox through Resend (https://resend.com), which needs three
 * environment variables on the server:
 *   RESEND_API_KEY   API key of the Resend account
 *   CONTACT_TO       inbox that receives the messages (default info@frankencoin.com)
 *   CONTACT_FROM     verified sender, e.g. "Frankencoin website <website@frankencoin.com>"
 * Without RESEND_API_KEY the endpoint answers 503 and the form shows the email address instead.
 *
 * Spam: a honeypot field ("website") that humans never see, a minimum fill time, and a per-IP rate limit.
 */
import type { APIRoute } from "astro";

export const prerender = false;

const TO = process.env.CONTACT_TO ?? "info@frankencoin.com";
const FROM = process.env.CONTACT_FROM ?? "Frankencoin website <website@frankencoin.com>";
const MIN_FILL_MS = 3000;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

const recent = new Map<string, number[]>();
const rateLimited = (ip: string) => {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > RATE_LIMIT.max;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let data: Record<string, unknown>;
  try {
    const type = request.headers.get("content-type") ?? "";
    data = type.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    return json(400, { ok: false, error: "bad_request" });
  }

  // Honeypot and fill-time checks: answer "ok" so bots learn nothing.
  if (clean(data.website, 10)) return json(200, { ok: true });
  const started = Number(data.started ?? 0);
  if (started && Date.now() - started < MIN_FILL_MS) return json(200, { ok: true });

  const name = clean(data.name, 120);
  const email = clean(data.email, 200);
  const company = clean(data.company, 160);
  const topic = clean(data.topic, 40);
  const message = String(data.message ?? "").trim().slice(0, 5000);
  const page = clean(data.page, 300);
  const lang = clean(data.lang, 5) || "en";

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) {
    return json(422, { ok: false, error: "validation" });
  }

  let ip = "unknown";
  try { ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || clientAddress; } catch { /* static preview */ }
  if (rateLimited(ip)) return json(429, { ok: false, error: "rate_limited" });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[contact] RESEND_API_KEY is not set; message from", email, "not delivered");
    return json(503, { ok: false, error: "not_configured" });
  }

  const subject = `[frankencoin.com] ${topic || "contact"}: ${name}${company ? ` (${company})` : ""}`;
  const lines = [
    `Name: ${name}`,
    `Email: ${email}`,
    company ? `Company: ${company}` : null,
    `Topic: ${topic || "-"}`,
    `Language: ${lang}`,
    page ? `Page: ${page}` : null,
    "",
    message,
  ].filter((l): l is string => l !== null);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: email,
      subject,
      text: lines.join("\n"),
      html: `<pre style="font: 14px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap">${escapeHtml(lines.join("\n"))}</pre>`,
    }),
  });

  if (!res.ok) {
    console.error("[contact] Resend error", res.status, await res.text().catch(() => ""));
    return json(502, { ok: false, error: "send_failed" });
  }
  return json(200, { ok: true });
};

export const GET: APIRoute = () => json(405, { ok: false, error: "method_not_allowed" });
