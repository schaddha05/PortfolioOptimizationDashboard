import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// 📦 Universe Definition
// ---------------------------------------------------------------------------
// S&P 500 tickers (abbreviated here for brevity; replace with full list)
export const SP500: string[] = [
  'AAPL', 'MSFT', 'GOOGL', /* ... all 500 tickers ... */
];
// 40 sample ETFs (adjust as needed)
export const ETF_UNIVERSE: string[] = [
  'VTI','VOO','SPY','IVV','QQQ','IWM','EFA','EEM','VNQ','LQD',
  'BND','AGG','TIP','HYG','XLK','XLY','XLP','XLE','XLF','XLV',
  'XLI','XLB','XLRE','XLU','IYR','ACWI','VEA','VWO','IEFA','SCHB',
  'EMB','GDX','GLD','SLV','DBC','USO','UNG','XME','XOP','VNQI'
];

export const UNIVERSE = [...SP500, ...ETF_UNIVERSE];

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
  const json = await res.json();
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

interface TimeSeries { [date: string]: { '4. close': string } }

/**
 * Compute weekly returns and annualized expected return and covariance matrix for a universe.
 */
export async function computeStats() {
  // 1. Gather time series for all tickers
  const seriesMap: Record<string, TimeSeries> = {};
  for (const ticker of UNIVERSE) {
    seriesMap[ticker] = await fetchWeeklySeries(ticker);
  }

  // 2. Align dates and compute returns
  const allDates = Object.keys(seriesMap[UNIVERSE[0]]).sort();
  const returns: number[][] = UNIVERSE.map((t) => {
    const sr = seriesMap[t];
    return allDates.slice(1).map((date, i) => {
      const prev = parseFloat(sr[allDates[i]]['4. close']);
      const curr = parseFloat(sr[date]['4. close']);
      return (curr - prev) / prev;
    });
  });

  // 3. μ (annualized mean returns)
  const weeklyMeans = returns.map(r => r.reduce((a,b)=>a+b,0)/r.length);
  const annualized = weeklyMeans.map(m => Math.pow(1 + m, 52) - 1);

  // 4. Σ (covariance)
  const covMatrix = math.cov(returns) as number[][];

  // 5. Cache globally
  writeCache('stats_returns', annualized);
  writeCache('stats_cov', covMatrix);

  return { annualized, covMatrix };
}
