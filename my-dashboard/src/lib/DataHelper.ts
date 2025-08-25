import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// 📦 Universe Definition
// ---------------------------------------------------------------------------
// S&P 500 tickers (not being used right now but ideally with no API call limits this will be used for the stocks we will get)
export const SP500: string[] = [
  'AAPL', 'MSFT', 'GOOGL', /* ... all 500 tickers ... */
];
// 6 tickers from Jupyter Notebook universe, ideally more if you can get premium API 
export const UNIVERSE = ['AMZN', 'GOOG', 'JPM', 'MA', 'XOM', 'CVX'] as const;
// ---------------------------------------------------------------------------
// 🔄 Cache utils
// ---------------------------------------------------------------------------
const CACHE_DIR = path.resolve(process.cwd(), 'data-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function cachePath(key: string) {
  return path.join(CACHE_DIR, `${key}.json`);
}

export function writeCache(key: string, data: any) {
  fs.writeFileSync(cachePath(key), JSON.stringify(data));
}

export function readCache<T>(key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(key), 'utf8')) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 📊 Data Fetchers
// ---------------------------------------------------------------------------
const API_KEY = process.env.ALPHA_VANTAGE_KEY;

/** Fetches full weekly-adjusted timeseries for a ticker. */
export async function fetchWeeklySeries(ticker: string) {
  const cacheKey = `weekly_${ticker}`;
  const cached = readCache<any>(cacheKey);
  if (cached) return cached;

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${ticker}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const json = await res.json() as {
    'Weekly Adjusted Time Series': Record<string, {
      '1. open': string; '2. high': string; '3. low': string; '4. close': string;
      '5. adjusted close': string; '6. volume': string; '7. dividend amount': string;
    }>
  };  
  const series = json['Weekly Adjusted Time Series'];
  writeCache(cacheKey, series);
  return series;
}

/** Fetches OVERVIEW fundamentals for a ticker. */
export async function fetchOverview(ticker: string) {
  const cacheKey = `overview_${ticker}`;
  const cached = readCache<any>(cacheKey);
  if (cached) return cached;

  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  writeCache(cacheKey, json);
  return json;
}

// ---------------------------------------------------------------------------
// 🔢 Feature Computations
// ---------------------------------------------------------------------------
import * as math from 'mathjs';

type WeeklyBar   = { "4. close": string; "7. dividend amount"?: string };
type TimeSeries  = Record<string, WeeklyBar>;

// -------------------------------------------------------------
// Compute weekly returns, μ (annualized mean), Σ (covariance),
// plus latest prices. Filters to tickers with usable data.
// -------------------------------------------------------------
export async function computeStats() {
  // 1) download weekly series for the whole UNIVERSE (with simple skip-on-error)
  const seriesMap: Record<string, TimeSeries> = {};
  for (const ticker of UNIVERSE) {
    try {
      const s = await fetchWeeklySeries(ticker);
      if (s && Object.keys(s).length > 0) {
        seriesMap[ticker] = s as TimeSeries;
      }
    } catch {
      /* ignore bad/missing tickers */
    }
  }

  // keep only tickers that actually have data
  let tickers = Object.keys(seriesMap);
  if (tickers.length === 0) {
    throw new Error("No time series available to compute stats.");
  }

  // 2) align by the intersection of dates across tickers
  //    (more robust than picking dates from a single symbol)
  const dateSets = tickers.map(t => new Set(Object.keys(seriesMap[t])));
  const alignedDates = Array.from(
    dateSets.reduce((acc, s) => {
      if (acc.size === 0) return new Set(s);
      const next = new Set<string>();
      acc.forEach(d => { if (s.has(d)) next.add(d); });
      return next;
    }, new Set<string>())
  ).sort(); // ascending

  // we need at least 2 dates to form 1 return
  if (alignedDates.length < 3) {
    throw new Error("Not enough overlapping history to compute returns.");
  }

  // 3) build returns matrix per ticker over the aligned dates
  const returns: number[][] = [];
  const latestPrices: Record<string, number> = {};

  const minObs = 30; // require at least ~30 weeks of overlap
  const kept: string[] = [];

  for (const t of tickers) {
    const sr = seriesMap[t];

    // latest price (last aligned date)
    const lastDate = alignedDates[alignedDates.length - 1];
    const lastClose = parseFloat(sr[lastDate]?.["4. close"] ?? "NaN");
    if (!Number.isFinite(lastClose)) continue;
    latestPrices[t] = lastClose;

    // weekly pct returns on aligned dates
    const r: number[] = [];
    for (let i = 1; i < alignedDates.length; i++) {
      const d0 = alignedDates[i - 1];
      const d1 = alignedDates[i];
      const p0 = parseFloat(sr[d0]?.["4. close"] ?? "NaN");
      const p1 = parseFloat(sr[d1]?.["4. close"] ?? "NaN");
      if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) {
        r.push(NaN);
      } else {
        r.push((p1 - p0) / p0);
      }
    }

    // drop series with too few valid observations
    const valid = r.filter(Number.isFinite);
    if (valid.length >= minObs) {
      returns.push(r.map(x => (Number.isFinite(x) ? x : 0))); // replace NaN with 0 for covariance
      kept.push(t);
    }
  }

  // if filtering removed symbols, update tickers and prices
  tickers = kept;
  Object.keys(latestPrices).forEach(t => {
    if (!kept.includes(t)) delete latestPrices[t];
  });

  if (tickers.length === 0) {
    throw new Error("No tickers with sufficient overlapping history.");
  }

  // 4) μ (annualized mean) – weekly mean → annualized
  const weeklyMeans = returns.map(r => {
    const v = r; // already NaN→0 above
    const sum = v.reduce((a, b) => a + b, 0);
    return sum / v.length;
  });
  const muVec = weeklyMeans.map(m => Math.pow(1 + m, 52) - 1);

  function covPair(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n <= 1) return 0;
    const meanA = a.reduce((s, x) => s + x, 0) / n;
    const meanB = b.reduce((s, x) => s + x, 0) / n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (a[i] - meanA) * (b[i] - meanB);
    return sum / (n - 1);
  }
  
  // 5) Σ (covariance matrix), annualized (weekly → yearly)
  const covWeekly: number[][] = Array.from({ length: returns.length }, (_, i) =>
  Array.from({ length: returns.length }, (_, j) => covPair(returns[i], returns[j]))
);
  const covMat: number[][] = covWeekly.map(row => row.map(v => v * 52));

  // 6) cache to disk (kept names from your original version)
  writeCache('stats_universe', tickers);
  writeCache('stats_returns', muVec);
  writeCache('stats_cov', covMat);
  writeCache('stats_prices', latestPrices);

  // 7) return everything the API route needs
  return {
    universe: tickers,
    muVec,
    covMat,
    latestPrices,
  };
}

export type FundamentalRow = {
  beta: number;
  divYield: number;   // trailing 12m, 0 if none
  logCap: number;     // log(MarketCapitalization) if available
  mom6: number;       // 26-week price change
  mom12: number;      // 52-week price change
  sector?: string;
};

function _toFloat(x: any, dflt = NaN) {
  const v = Number(x);
  return Number.isFinite(v) ? v : dflt;
}

function ttmDivYieldFromWeekly(ts: TimeSeries): number {
  const datesAsc = Object.keys(ts).sort();
  if (datesAsc.length === 0) return 0;
  const lastClose = _toFloat(ts[datesAsc[datesAsc.length - 1]]["4. close"], NaN);
  if (!Number.isFinite(lastClose) || lastClose <= 0) return 0;

  // sum last ~52 weeks of "7. dividend amount"
  const last52 = datesAsc.slice(-52);
  const divSum = last52.reduce((acc, d) => acc + _toFloat(ts[d]["7. dividend amount"] ?? 0, 0), 0);
  return Math.max(0, divSum / lastClose);
}

function momentumFromCloses(ts: TimeSeries, weeks: number): number {
  const datesAsc = Object.keys(ts).sort();
  if (datesAsc.length < weeks + 1) return 0;
  const last = _toFloat(ts[datesAsc[datesAsc.length - 1]]["4. close"], NaN);
  const prev = _toFloat(ts[datesAsc[datesAsc.length - 1 - weeks]]["4. close"], NaN);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return 0;
  return last / prev - 1;
}

export async function getFundamentalMap(
  tickers: string[]
): Promise<Record<string, FundamentalRow>> {
  const out: Record<string, FundamentalRow> = {};

  for (const sym of tickers) {
    const o = await fetchOverview(sym);        // may be {}, that’s fine
    const ts = await fetchWeeklySeries(sym);   // cached

    const beta = _toFloat(o?.Beta, NaN);
    const mcap = _toFloat(o?.MarketCapitalization, NaN);
    const logCap = Number.isFinite(mcap) && mcap > 0 ? Math.log(mcap) : NaN;

    // robust div yield (handles ETFs + non-payers)
    const divYield = ttmDivYieldFromWeekly(ts);

    // momentum (6m = 26w, 12m = 52w)
    const mom6 = momentumFromCloses(ts, 26);
    const mom12 = momentumFromCloses(ts, 52);

    out[sym] = {
      beta,
      divYield,
      logCap,
      mom6,
      mom12,
      sector: o?.Sector ?? undefined,
    };
  }
  return out;
}