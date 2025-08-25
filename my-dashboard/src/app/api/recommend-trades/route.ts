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

/** Small helper to stringify errors nicely */
function errJson(message: string, extra?: unknown, status = 500) {
  if (extra) console.error("[recommend-trades]", message, extra);
  else console.error("[recommend-trades]", message);
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const holdings = Array.isArray(body?.holdings) ? body.holdings : [];
    const targetReturn = Number(body?.targetReturn);
    const budget = Number(body?.budget ?? 0);

    if (!Number.isFinite(targetReturn))
      return errJson("targetReturn must be a number", { body }, 400);

    // 1) Stats for full universe (from cache if present)
    const { universe, muVec, covMat, latestPrices } = await computeStats();

    // 2) Optimized weights for user's target
    const wStar = meanVarianceOptimization(muVec, covMat, targetReturn);

    // 3) What user already holds
    const heldTickers = new Set<string>(
      holdings
        .map((h: any) => String(h?.ticker || "").trim().toUpperCase())
        .filter(Boolean)
    );
    const heldIdx = new Set<number>(
      [...heldTickers].map((t) => universe.indexOf(t)).filter((i) => i >= 0)
    );

    // 4) Marginal utility for all candidates
    const metricsArr = computeMarginalUtilities(
      wStar,
      muVec,
      covMat,
      universe,
      heldIdx,
    );
    const marginalMap = toMarginalMap(metricsArr);

    // 5) Only symbols not already held and present in the map
    const candidates = universe.filter(
      (t) => !heldTickers.has(t) && marginalMap[t] !== undefined
    );
    if (candidates.length === 0) {
      return NextResponse.json({ recommendations: [], featureOrder: [] });
    }

    // 6) Fundamentals/momentum needed for features
    const rawFundamentals = await getFundamentalMap(universe);
    // Narrow to exactly what buildFeatureMatrix expects
    type NarrowFund = Record<string, {
      momentum6m: number;
      momentum12m: number;
      beta: number;
      divYield: number;
      logCap: number;
    }>;

    const fundamentals: NarrowFund = {};
    for (const t of universe) {
      const r: any = rawFundamentals[t];
      if (!r) continue;
      fundamentals[t] = {
        // support a few possible field names (mom6/mom12 vs momentum6m/12m)
        momentum6m: Number(r.momentum6m ?? r.mom6 ?? 0),
        momentum12m: Number(r.momentum12m ?? r.mom12 ?? 0),
        beta:        Number(r.beta ?? 0),
        divYield:    Number(r.divYield ?? 0),
        logCap:      Number(r.logCap ?? 0),
      };
    }

    // 7) Build feature matrix that matches training FEATURE_ORDER
    const X = buildFeatureMatrix(candidates, marginalMap, fundamentals, targetReturn);
    if (!Array.isArray(X) || X.length === 0 || !Array.isArray(X[0])) {
      return errJson("Feature matrix is empty or malformed", { candidatesLen: candidates.length }, 500);
    }

    // 8) Load ONNX model + columns (for debugging/consistency)
    const modelPath = path.join(process.cwd(), "src/lib/recommend_model.onnx");
    const colsPath  = path.join(process.cwd(), "src/lib/recommend_columns.json");
    if (!fs.existsSync(modelPath)) return errJson("ONNX model not found", { modelPath }, 500);
    if (!fs.existsSync(colsPath))  return errJson("Columns JSON not found", { colsPath }, 500);

    const featureOrder: string[] = JSON.parse(fs.readFileSync(colsPath, "utf8"));
    if (featureOrder.length !== X[0].length) {
      return errJson("Feature dimension mismatch", {
        expected: featureOrder.length, got: X[0].length,
      }, 500);
    }

    // 9) Score with onnxruntime
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
    const inputName = session.inputNames[0]; // 'input'/'float_input' depending on export
    const tensor = new ort.Tensor("float32", Float32Array.from(X.flat()), [X.length, X[0].length]);
    const out = await session.run({ [inputName]: tensor });
    const outName = session.outputNames[0];
    const scores = Array.from(out[outName].data as Float32Array);

    // 10) Rank and size trades
    const ranked = candidates
      .map((t, i) => ({ ticker: t, score: scores[i] }))
      .sort((a, b) => b.score - a.score);

    const k = Math.min(5, ranked.length);
    const top = ranked.slice(0, k);

    const perBucket = budget > 0 ? budget / k : 0;
    const recommendations = top.map((r) => {
      const px = latestPrices[r.ticker] ?? 0;
      const shares =
        perBucket > 0 && px > 0 ? Math.max(1, Math.floor(perBucket / px)) : 0;
      return {
        ticker: r.ticker,
        score: r.score,
        price: px,
        shares,
        reason: "High P(improve Sharpe) for your target",
      };
    });

    return NextResponse.json({ recommendations, featureOrder });
  } catch (e) {
    // You’ll see this in your server terminal
    return errJson("Failed to compute recommendations", e, 500);
  }
}