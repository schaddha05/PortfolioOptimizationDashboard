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

// --- helper: inverse CDF of standard normal (Acklam's approximation) ---
function normInv(p: number): number {
  // https://web.archive.org/web/20150910044701/http://home.online.no/~pjacklam/notes/invnorm/
  const a1 = -39.69683028665376, a2 = 220.9460984245205, a3 = -275.9285104469687,
        a4 = 138.3577518672690, a5 = -30.66479806614716, a6 =  2.506628277459239;
  const b1 = -54.47609879822406, b2 = 161.5858368580409, b3 = -155.6989798598866,
        b4 =  66.80131188771972, b5 = -13.28068155288572;
  const c1 = -0.007784894002430293, c2 = -0.3223964580411365, c3 = -2.400758277161838,
        c4 = -2.549732539343734, c5 =  4.374664141464968, c6 =  2.938163982698783;
  const d1 =  0.007784695709041462, d2 =  0.3224671290700398, d3 =  2.445134137142996,
        d4 =  3.754408661907416;

  const plow = 0.02425, phigh = 1 - plow;
  let q: number, r: number;

  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q + c2)*q + c3)*q + c4)*q + c5)*q + c6) /
           ((((d1*q + d2)*q + d3)*q + d4)*q + 1);
  }
  if (phigh < p) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1*q + c2)*q + c3)*q + c4)*q + c5)*q + c6) /
             ((((d1*q + d2)*q + d3)*q + d4)*q + 1);
  }
  q = p - 0.5; r = q*q;
  return (((((a1*r + a2)*r + a3)*r + a4)*r + a5)*r + a6) * q /
         (((((b1*r + b2)*r + b3)*r + b4)*r + b5)*r + 1);
}

// Approximate CVaR (Expected Shortfall) for a normal portfolio
function cvarNorm(w: number[], mu: number[], cov: number[][]): number {
  const mean = portfolioReturn(w, mu);
  const var_ = portfolioVariance(w, cov);
  const std  = Math.sqrt(Math.max(var_, 1e-12));

  // one-sided 95% tail quantile of N(0,1)
  const z   = normInv(CVAR_ALPHA);                  // ≈ 1.64485 for 0.95
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

  // left-tail expected shortfall of returns
  const es  = mean - std * (pdf / (1 - CVAR_ALPHA));

  // return a positive risk number (loss)
  return -es;
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

