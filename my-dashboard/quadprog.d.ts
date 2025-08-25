// src/types/quadprog.d.ts
declare module 'quadprog' {
  export interface QPResult {
    solution: number[];     // optimal w
    value: number;          // objective value (0.5 w^T D w - d^T w)
    message?: string;       // solver message
    iterations?: number;
  }

  // Signature used by the quadprog package
  export function solveQP(
    D: number[][],          // positive semidefinite (n x n)
    d: number[],            // (n)
    A: number[][],          // constraints (n x m) as columns, see package docs
    b: number[],            // (m)
    meq?: number            // number of equality constraints (first meq columns)
  ): QPResult;
}