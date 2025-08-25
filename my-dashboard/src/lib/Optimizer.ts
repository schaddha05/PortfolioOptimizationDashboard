import * as math from 'mathjs';
import { solveQP } from 'quadprog';
// ---------------------------------------------------------------------------
// Mean-Variance Portfolio Optimizer (Quadratic Programming)
// ---------------------------------------------------------------------------

/**
 * Solve the mean-variance optimization:
 *   minimize (1/2) w^T Σ w
 *   subject to μ^T w = targetReturn, 1^T w = 1, w >= 0
 * @param mu      Expected return vector (length n)
 * @param sigma   Covariance matrix (n×n)
 * @param targetReturn  Desired portfolio return
 * @returns Weight vector w (length n)
 */
export function meanVarianceOptimization(
  mu: number[],
  sigma: number[][],
  targetReturn: number
): number[] {
  const n = mu.length;

  // Dmat = 2 * Σ  (plain number[][])
  const Dmat: number[][] = sigma.map(row => row.map(v => 2 * v));

  // dvec = zero vector (plain number[])
  const dvec: number[] = new Array(n).fill(0);

  // Constraints in quadprog form: minimize 1/2 x^T D x - d^T x  s.t.  A^T x ≥ b
  // We'll use:
  //   (1) sum(w) = 1              -> equality
  //   (2) mu · w ≥ targetReturn   -> inequality
  //   (3) w ≥ 0                   -> inequalities

  const ones = new Array(n).fill(1);

  // Identity columns for w ≥ 0
  const eyeCols: number[][] = Array.from({ length: n }, (_, i) => {
    const col = new Array(n).fill(0);
    col[i] = 1;
    return col;
  });

  // Amat is (n x m) = transpose of columns [ones, mu, I]
  const Amat: number[][] = math.transpose([ones, mu, ...eyeCols]) as number[][];

  // bvec aligns with those columns
  const bvec: number[] = [1, targetReturn, ...new Array(n).fill(0)];

  // One equality (sum(w)=1). 'mu·w ≥ target' and 'w ≥ 0' remain inequalities.
  const meq = 1;

  // Solve (note: we imported { solveQP }, so call it directly)
  const res = solveQP(Dmat, dvec, Amat, bvec, meq);

  // Return a plain array of weights
  return Array.from(res.solution);
}
