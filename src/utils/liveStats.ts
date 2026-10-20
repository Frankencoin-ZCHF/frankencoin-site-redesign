/**
 * Live figures for the landing pages, read on the server from public APIs and cached for 5 minutes
 * (24 hours for the FX history). Any failed read leaves its value null/empty; pages render "—".
 *
 * - Borrow terms: `/positions/open` + collateral prices from `/ecosystem/collateral/stats`.
 * - Transparency: `/ecosystem/frankencoin/info`, `/ecosystem/collateral/stats`, `/ecosystem/fps/info`.
 * - USD→CHF history: ECB reference rates via frankfurter.dev, one point per year since 1999.
 */
const API = process.env.FRANKENCOIN_API_URL ?? "https://api.frankencoin.com";
const TIMEOUT_MS = 8000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

function cached<T>(ttlMs: number, load: () => Promise<T>, ok: (v: T) => boolean): () => Promise<T> {
  let entry: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return () => {
    if (entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value);
    inflight ??= load()
      .then((v) => {
        if (ok(v)) entry = { at: Date.now(), value: v };
        return v;
      })
      .finally(() => (inflight = null));
    return inflight;
  };
}

const warn = (what: string, e: unknown) => console.warn(`[live] ${what}:`, e instanceof Error ? e.message : e);

// ---------------------------------------------------------------------------- collateral prices

interface CollateralStat {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  totalMinted: number;
  totalLimit: number;
  totalValueLocked: { chf: number };
  price: { chf: number };
  positions: { open: number };
}
interface CollateralStats {
  totalValueLocked: { chf: number };
  map: Record<string, CollateralStat>;
}
const collateralStats = cached(
  5 * 60_000,
  () => getJson<CollateralStats>(`${API}/ecosystem/collateral/stats`),
  (v) => !!v?.map
);

// ---------------------------------------------------------------------------- borrow terms

export interface BorrowOption {
  symbol: string;
  name: string;
  /** liquidation price / market price */
  ltv: number;
  /** effective yearly interest as a fraction (on the amount actually received) */
  interest: number;
  /** ZCHF that can still be minted against this collateral */
  available: number;
  maturity: number;
  href: string;
}

interface OpenPosition {
  position: string;
  collateral: string;
  collateralSymbol: string;
  collateralName: string;
  collateralDecimals: number;
  price: string;
  annualInterestPPM: number;
  reserveContribution: number;
  availableForClones: string;
  expiration: number;
  closed: boolean;
  denied: boolean;
}

const MIN_RUNWAY_S = 30 * 86400;

export const getBorrowOptions = cached(
  5 * 60_000,
  async (): Promise<BorrowOption[]> => {
    try {
      const [open, stats] = await Promise.all([
        getJson<{ map: Record<string, OpenPosition> }>(`${API}/positions/open`),
        collateralStats(),
      ]);
      const now = Date.now() / 1000;
      const best = new Map<string, BorrowOption>();
      for (const p of Object.values(open.map ?? {})) {
        if (p.closed || p.denied || p.expiration < now + MIN_RUNWAY_S) continue;
        const available = Number(BigInt(p.availableForClones)) / 1e18;
        if (available < 1000) continue;
        const market = stats.map?.[p.collateral.toLowerCase()]?.price?.chf;
        const liq = Number(BigInt(p.price)) / 10 ** (36 - p.collateralDecimals);
        if (!market || !Number.isFinite(liq)) continue;
        const opt: BorrowOption = {
          symbol: p.collateralSymbol,
          name: p.collateralName,
          ltv: liq / market,
          // Effective rate on what the borrower receives: the retained reserve does not reach them (same as the app).
          interest: p.annualInterestPPM / (1_000_000 - p.reserveContribution),
          available,
          maturity: p.expiration,
          href: `https://app.frankencoin.com/mint/${p.position}`,
        };
        if (opt.ltv <= 0 || opt.ltv >= 1) continue;
        const prev = best.get(p.collateral);
        if (!prev || opt.interest < prev.interest || (opt.interest === prev.interest && opt.ltv > prev.ltv)) best.set(p.collateral, opt);
      }
      return [...best.values()].sort((a, b) => b.available - a.available);
    } catch (e) {
      warn("borrow options", e);
      return [];
    }
  },
  (v) => v.length > 0
);

// ---------------------------------------------------------------------------- transparency

export interface Transparency {
  supply: number | null;
  supplyByChain: { chain: string; supply: number }[];
  collateralChf: number | null;
  collateral: { symbol: string; name: string; chf: number; minted: number; positions: number }[];
  equity: number | null;
  reserve: number | null;
  updated: number;
}

const CHAINS: Record<string, string> = {
  "1": "Ethereum",
  "10": "Optimism",
  "100": "Gnosis",
  "137": "Polygon",
  "146": "Sonic",
  "8453": "Base",
  "42161": "Arbitrum",
  "43114": "Avalanche",
};

export const getTransparency = cached(
  5 * 60_000,
  async (): Promise<Transparency> => {
    const [info, stats, fps] = await Promise.allSettled([
      getJson<{ token?: { supply?: number }; chains?: Record<string, { supply: number }> }>(`${API}/ecosystem/frankencoin/info`),
      collateralStats(),
      getJson<{ reserve?: { balance?: number; equity?: number } }>(`${API}/ecosystem/fps/info`),
    ]);
    for (const r of [info, stats, fps]) if (r.status === "rejected") warn("transparency", r.reason);
    const i = info.status === "fulfilled" ? info.value : null;
    const s = stats.status === "fulfilled" ? stats.value : null;
    const f = fps.status === "fulfilled" ? fps.value : null;
    return {
      supply: i?.token?.supply ?? null,
      supplyByChain: Object.entries(i?.chains ?? {})
        .map(([id, c]) => ({ chain: CHAINS[id] ?? `Chain ${id}`, supply: c.supply }))
        .filter((c) => c.supply >= 1)
        .sort((a, b) => b.supply - a.supply),
      collateralChf: s?.totalValueLocked?.chf ?? null,
      collateral: Object.values(s?.map ?? {})
        .map((c) => ({ symbol: c.symbol, name: c.name, chf: c.totalValueLocked?.chf ?? 0, minted: c.totalMinted ?? 0, positions: c.positions?.open ?? 0 }))
        .filter((c) => c.chf >= 1000)
        .sort((a, b) => b.chf - a.chf),
      equity: f?.reserve?.equity ?? null,
      reserve: f?.reserve?.balance ?? null,
      updated: Math.floor(Date.now() / 1000),
    };
  },
  (v) => v.supply !== null && v.collateralChf !== null
);

// ---------------------------------------------------------------------------- USD → CHF history

export interface FxHistory {
  /** [year, CHF per 1 USD] at the first trading day of each year, plus today */
  points: [number, number][];
}

export const getUsdChfHistory = cached(
  24 * 3600_000,
  async (): Promise<FxHistory> => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const d = await getJson<{ rates: Record<string, { CHF: number }> }>(
        `https://api.frankfurter.dev/v1/1999-01-04..${today}?base=USD&symbols=CHF`
      );
      const byYear = new Map<number, number>();
      const dates = Object.keys(d.rates ?? {}).sort();
      for (const day of dates) {
        const y = Number(day.slice(0, 4));
        if (!byYear.has(y)) byYear.set(y, d.rates[day].CHF);
      }
      const points: [number, number][] = [...byYear.entries()];
      const last = dates[dates.length - 1];
      if (last) points.push([Number(last.slice(0, 4)) + Number(last.slice(5, 7)) / 12, d.rates[last].CHF]);
      return { points };
    } catch (e) {
      warn("usd/chf history", e);
      return { points: [] };
    }
  },
  (v) => v.points.length > 5
);

/** SVG path (viewBox 0 0 100 40) for a series; returns line + filled area. */
export function sparkPath(values: number[], height = 40): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, height - 4 - ((v - min) / span) * (height - 8)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return { line, area: `${line} L100 ${height} L0 ${height} Z` };
}
