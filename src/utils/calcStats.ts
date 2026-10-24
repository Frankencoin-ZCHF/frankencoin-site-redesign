/**
 * Data for the "What if" calculator (home, /start, savings pages).
 *
 * Everything is read on the server from api.frankencoin.com (no CSP change needed) and cached
 * for 5 minutes. The page injects the compact result as JSON; the Alpine component in
 * Calculator.astro does the arithmetic in the browser.
 *
 * - FPS/FCS price history and total savings come from the daily log (`/analytics/dailyLog/json`).
 *   FCS is priced at the FPS valuation, so one FPS price series serves both tokens.
 * - The savings rate history comes from `/savings/leadrate/rates` (mainnet modules). The rate is
 *   `approvedRate` is in parts per million: 35000 = 3.5%.
 * - Fiat conversion uses ECB reference rates via frankfurter.dev with a static fallback, and is
 *   labelled as approximate in the UI.
 */
import { getFcsStats } from "./fcsStats";

export interface CalcData {
  /** [unix seconds, FPS price in ZCHF] sampled weekly plus the latest day. */
  fps: [number, number][];
  /** [unix seconds, yearly rate as a fraction] in chronological order. Rate applies from that time on. */
  rates: [number, number][];
  current: {
    rate: number | null; // fraction, e.g. 0.035
    fpsPrice: number | null;
    roe12m: number | null;
    totalSavings: number | null;
    updated: number | null; // unix seconds of the last daily log
  };
  /** How many units of the currency one CHF buys. */
  fx: { CHF: number; USD: number; EUR: number; approximate: boolean };
}

const API_BASE = process.env.FRANKENCOIN_API_URL ?? "https://api.frankencoin.com";
const TIMEOUT_MS = 8000;
const TTL_MS = 5 * 60 * 1000;
const WEEK_S = 7 * 86400;
/** FCS price history starts after the launch phase (Oct 2023 – Apr 2024), when the price was set by the first capital coming in. */
const FPS_HISTORY_FROM_S = Date.UTC(2024, 4, 1) / 1000;
const FX_FALLBACK = { CHF: 1, USD: 1.25, EUR: 1.07 };

const num = (v: string | number | undefined) => (v === undefined ? NaN : Number(BigInt(String(v))) / 1e18);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

interface DailyLog {
  timestamp: string;
  fpsPrice: string;
  totalSavings: string;
}

async function readDailyLog(): Promise<Pick<CalcData, "fps"> & { totalSavings: number | null; updated: number | null; fpsPrice: number | null }> {
  const { logs } = await getJson<{ logs?: DailyLog[] }>(`${API_BASE}/analytics/dailyLog/json`);
  if (!logs?.length) throw new Error("empty daily log");
  const fps: [number, number][] = [];
  let lastKept = -Infinity;
  for (const l of logs) {
    const ts = Number(l.timestamp);
    const price = num(l.fpsPrice);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || ts < FPS_HISTORY_FROM_S) continue;
    if (ts - lastKept >= WEEK_S) {
      fps.push([ts, Math.round(price * 100) / 100]);
      lastKept = ts;
    }
  }
  const last = logs[logs.length - 1];
  const lastTs = Number(last.timestamp);
  const lastPrice = num(last.fpsPrice);
  if (fps.length && fps[fps.length - 1][0] !== lastTs) fps.push([lastTs, Math.round(lastPrice * 100) / 100]);
  return {
    fps,
    totalSavings: Number.isFinite(num(last.totalSavings)) ? num(last.totalSavings) : null,
    updated: lastTs,
    fpsPrice: Number.isFinite(lastPrice) ? lastPrice : null,
  };
}

interface RateEntry {
  created: number;
  approvedRate: number;
}

/** Savings rate history on mainnet, merged across modules: at any time, the newest module that already existed wins. */
async function readRates(): Promise<{ rates: [number, number][]; current: number | null }> {
  const data = await getJson<{ list?: Record<string, Record<string, RateEntry[]>> }>(`${API_BASE}/savings/leadrate/rates`);
  const modules = Object.values(data.list?.["1"] ?? {});
  if (!modules.length) throw new Error("no mainnet savings modules");
  // Order modules by their first appearance; later modules supersede earlier ones from their start.
  const ordered = modules
    .map((entries) => [...entries].sort((a, b) => a.created - b.created))
    .filter((e) => e.length)
    .sort((a, b) => a[0].created - b[0].created);
  const rates: [number, number][] = [];
  for (let i = 0; i < ordered.length; i++) {
    const nextStart = ordered[i + 1]?.[0].created ?? Infinity;
    for (const e of ordered[i]) if (e.created < nextStart) rates.push([e.created, e.approvedRate / 1_000_000]);
  }
  rates.sort((a, b) => a[0] - b[0]);
  return { rates, current: rates.length ? rates[rates.length - 1][1] : null };
}

async function readFx(): Promise<CalcData["fx"]> {
  try {
    const d = await getJson<{ rates?: { USD?: number; EUR?: number } }>("https://api.frankfurter.dev/v1/latest?base=CHF&symbols=USD,EUR");
    if (d.rates?.USD && d.rates?.EUR) return { CHF: 1, USD: d.rates.USD, EUR: d.rates.EUR, approximate: false };
  } catch (e) {
    console.warn("[calc] fx read failed:", e instanceof Error ? e.message : e);
  }
  return { ...FX_FALLBACK, approximate: true };
}

let cache: { at: number; value: CalcData } | null = null;
let inflight: Promise<CalcData> | null = null;

async function load(): Promise<CalcData> {
  const [log, rates, fx, fcs] = await Promise.allSettled([readDailyLog(), readRates(), readFx(), getFcsStats()]);
  const l = log.status === "fulfilled" ? log.value : null;
  const r = rates.status === "fulfilled" ? rates.value : null;
  for (const x of [log, rates]) if (x.status === "rejected") console.warn("[calc] read failed:", x.reason instanceof Error ? x.reason.message : x.reason);
  return {
    fps: l?.fps ?? [],
    rates: r?.rates ?? [],
    current: {
      rate: r?.current ?? null,
      fpsPrice: l?.fpsPrice ?? (fcs.status === "fulfilled" ? fcs.value.fcsPrice : null),
      roe12m: fcs.status === "fulfilled" ? fcs.value.roe12m : null,
      totalSavings: l?.totalSavings ?? null,
      updated: l?.updated ?? null,
    },
    fx: fx.status === "fulfilled" ? fx.value : { ...FX_FALLBACK, approximate: true },
  };
}

export async function getCalcData(): Promise<CalcData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  inflight ??= load()
    .then((value) => {
      if (value.fps.length && value.rates.length) cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
