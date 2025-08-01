import * as math from 'mathjs';
import quadprog from 'quadprog';

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

  // Dmat = 2 * Σ
  const Dmat = math.multiply(sigma, 2) as number[][];
  // dvec = zero vector
  const dvec = math.zeros(n)._data as number[];

  // Constraints: A^T x >= b
  // We need equality constraints, so we set two rows:
  // mu^T w >= targetReturn and -mu^T w >= -targetReturn
  // sum(w)=1 and -sum(w)=-1
  // But quadprog expects form: A^T x >= b
  
  const A: number[][] = [];
  const b: number[] = [];

  // mu^T w == targetReturn -> split into >= and <=
  A.push(mu);
  b.push(targetReturn);
  A.push(mu.map(v => -v));
  b.push(-targetReturn);

  // 1^T w == 1
  const ones = Array(n).fill(1);
  A.push(ones);
  b.push(1);
  A.push(ones.map(v => -v));
  b.push(-1);

  // w >= 0
  for (let i = 0; i < n; i++) {
    const ei = Array(n).fill(0);
    ei[i] = 1;
    A.push(ei);
    b.push(0);
  }

  // quadprog solves: min .5 x'D x - d^T x s.t. C^T x >= b
  const result = quadprog.solveQP(Dmat, dvec, math.transpose(A) as number[][], b);
  if (result.message) {
    console.warn('QP solver message:', result.message);
  }
  return result.solution;
}
