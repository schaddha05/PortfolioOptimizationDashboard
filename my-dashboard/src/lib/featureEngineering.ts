import * as math from 'mathjs';

// ---------------------------------------------------------------------------
// 🛠️ Portfolio utility helpers
// ---------------------------------------------------------------------------
const RISK_FREE = 0.043; // 4.3 % rf, annualised
const CVAR_ALPHA = 0.95; // CVaR 95 %

export const FEATURE_ORDER = [
  "deltaSharpe", "deltaCvar", "mom6", "mom12", "beta", "divYield", "logCap", "targetReturn",
] as const;
export type FeatureName = typeof FEATURE_ORDER[number];

/** Annualised portfolio variance given weights and covariance */
function portfolioVariance(w: number[], cov: number[][]): number {
  // math.multiply handles matrix × vector
  const wT = math.transpose(w) as number[];
  return math.multiply(math.multiply(wT, cov) as number[], w) as number;
}

function portfolioReturn(w: number[], mu: number[]): number {
  return math.dot(w, mu) as number;
}

function sharpe(w: number[], mu: number[], cov: number[][]): number {
  const mean = portfolioReturn(w, mu);
  const vol = Math.sqrt(portfolioVariance(w, cov));
  return (mean - RISK_FREE) / vol;
}

/**
 * Approximate CVaR for a multivariate-normal portfolio.
 * For normal dist.: CVaR = mean - k * std, where k = φ/α with φ PDF, α = 1-CVaRLevel
 */
function cvarNorm(w: number[], mu: number[], cov: number[][], alpha = CVAR_ALPHA): number {
  const mean = portfolioReturn(w, mu);
  const std = Math.sqrt(portfolioVariance(w, cov));
  const z = math.quantile(1 - alpha, 'normal') as number; // VaR quantile
  const pdf = math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const k = pdf / (1 - alpha);
  return -(mean - std * k); // negative => loss
}

// ---------------------------------------------------------------------------
// 🚀 Marginal utilities + feature assembly
// ---------------------------------------------------------------------------
export interface MarginalMetrics {
  ticker: string;
  deltaSharpe: number;
  deltaCvar: number;
}

/**
 * Compute ΔSharpe and ΔCVaR for each candidate not in the current portfolio.
 * @param wStar optimal weight vector (length n)
 * @param mu expected returns (annualised)
 * @param cov covariance matrix
 * @param tickers array of tickers in same index order as mu / cov
 * @param heldIdx set of indices currently held (so they are excluded)
 */
export function computeMarginalUtilities(
  wStar: number[],
  mu: number[],
  cov: number[][],
  tickers: string[],
  heldIdx: Set<number>,
): MarginalMetrics[] {
  const baseSharpe = sharpe(wStar, mu, cov);
  const baseCvar = cvarNorm(wStar, mu, cov);

  const eps = 0.01; // 1 % incremental weight shift
  const metrics: MarginalMetrics[] = [];

  tickers.forEach((ticker, idx) => {
    if (heldIdx.has(idx)) return; // skip current holdings

    const wPert = [...wStar];
    // take ε from the largest weight (or cash) — simplistic redistribution
    const donor = wPert.findIndex((w) => w === Math.max(...wPert));
    wPert[donor] = Math.max(0, wPert[donor] - eps);
    wPert[idx] += eps;

    const s = sharpe(wPert, mu, cov);
    const cv = cvarNorm(wPert, mu, cov);

    metrics.push({
      ticker,
      deltaSharpe: s - baseSharpe,
      deltaCvar: baseCvar - cv, // positive means CVaR improved (less risk)
    });
  });

  return metrics;
}

export function toMarginalMap(
  arr: { ticker: string; deltaSharpe: number; deltaCvar: number }[]
): Record<string, { deltaSharpe: number; deltaCvar: number }> {
  return Object.fromEntries(arr.map(m => [m.ticker, { deltaSharpe: m.deltaSharpe, deltaCvar: m.deltaCvar }]));
}

/** Build feature matrix (each row aligned with candidates[] order). */
export function buildFeatureMatrix(
  candidates: string[],
  marginal: Record<string, { deltaSharpe: number; deltaCvar: number }>,
  fundamentals: Record<string, {
    momentum6m: number; momentum12m: number; beta: number; divYield: number; logCap: number
  }>,
  targetReturn: number,
): number[][] {
  return candidates.map((t) => {
    const m = marginal[t] ?? { deltaSharpe: 0, deltaCvar: 0 };
    const f = fundamentals[t] ?? { momentum6m: 0, momentum12m: 0, beta: 0, divYield: 0, logCap: 0 };

    const row: Record<FeatureName, number> = {
      deltaSharpe: m.deltaSharpe,
      deltaCvar:   m.deltaCvar,
      mom6:        f.momentum6m,
      mom12:       f.momentum12m,
      beta:        f.beta,
      divYield:    f.divYield,
      logCap:      f.logCap,
      targetReturn,
    };

    // enforce column order exactly as your model expects
    return FEATURE_ORDER.map((k) => row[k]);
  });
}

