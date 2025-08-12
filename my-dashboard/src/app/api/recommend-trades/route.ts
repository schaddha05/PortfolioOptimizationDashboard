import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import ort from "onnxruntime-node";

import { computeStats, getFundamentalMap } from "@/lib/DataHelper";
import { meanVarianceOptimization } from "@/lib/Optimizer";
import {
  computeMarginalUtilities,
  toMarginalMap,
  buildFeatureMatrix,
} from "@/lib/featureEngineering";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { holdings, targetReturn, budget = 0 } = await req.json();

    // 1) Load data + optimise to user's target
    const { universe, muVec, covMat, latestPrices } = await computeStats();
    const wStar = meanVarianceOptimization(muVec, covMat, targetReturn);

    // 2) Figure out what the user already holds
    const heldSet = new Set<string>(holdings.map((h: any) => h.ticker));

    // 3) Compute marginal utilities for all candidates not held
    const metricsArr = computeMarginalUtilities({
      wStar,
      mu: muVec,
      cov: covMat,
      tickers: universe,
      heldIdx: new Set<number>([...heldSet].map(t => universe.indexOf(t)).filter(i => i >= 0)),
    }); // => MarginalMetrics[]

    const marginalMap = toMarginalMap(metricsArr); // ticker -> { deltaSharpe, deltaCvar }

    // 4) Limit to candidates not already held and present in map
    const candidates = universe.filter(t => !heldSet.has(t) && marginalMap[t] !== undefined);
    if (candidates.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // 5) Fundamentals/momentum for those candidates
    const fundamentals = await getFundamentalMap(universe); // has beta, divYield, logCap, momentum6m, momentum12m

    // 6) Build feature matrix (must match training FEATURE_ORDER)
    const X = buildFeatureMatrix(candidates, marginalMap, fundamentals, targetReturn);

    // 7) Load ONNX model and score
    const modelPath = path.join(process.cwd(), "src/lib/recommend_model.onnx");
    const colsPath  = path.join(process.cwd(), "src/lib/recommend_columns.json");
    const featureOrder = JSON.parse(fs.readFileSync(colsPath, "utf8"));

    const session = await ort.InferenceSession.create(modelPath);
    const inputName = session.inputNames[0]; // matches your converter ('input'/'float_input')
    const tensor = new ort.Tensor("float32", Float32Array.from(X.flat()), [X.length, X[0].length]);
    const out = await session.run({ [inputName]: tensor });
    const outName = session.outputNames[0];
    const scores = Array.from(out[outName].data as Float32Array);

    // 8) Rank + size 3-5 trades
    const k = Math.min(5, candidates.length);
    const ranked = candidates.map((t, i) => ({ ticker: t, score: scores[i] }))
                             .sort((a, b) => b.score - a.score)
                             .slice(0, k);

    const perBucket = budget > 0 ? budget / k : 0;
    const recommendations = ranked.map(r => {
      const px = latestPrices[r.ticker] ?? 0;
      const shares = perBucket > 0 && px > 0 ? Math.max(1, Math.floor(perBucket / px)) : 0;
      return { ticker: r.ticker, score: r.score, price: px, shares, reason: "High P(improve Sharpe) for your target" };
    });

    return NextResponse.json({ recommendations, featureOrder });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to compute recommendations" }, { status: 500 });
  }
}
