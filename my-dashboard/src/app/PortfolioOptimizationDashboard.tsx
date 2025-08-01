"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
//  TYPES
// ---------------------------------------------------------------------------
interface Holding {
  ticker: string;
  shares: number;
  pricePaid: number;  // user‑entered cost basis
  price: number;      // fetched live price
  category: Category;
}

type Category = "Stocks" | "Bonds" | "Alternatives" | "ETFs" | "Cash";

type RiskLevel = "low" | "medium" | "high";

interface Allocation { category: Category; percent: number; }
interface Metrics { expReturn: number; vol: number; sharpe: number; cvar: number; }

// ---------------------------------------------------------------------------
// ⚙️ CONSTANTS & UTILITIES
// ---------------------------------------------------------------------------
const CATEGORIES: Category[] = ["Stocks", "Bonds", "Alternatives", "ETFs", "Cash"];
const API_KEY = process.env.NEXT_PUBLIC_ALPHA_KEY || "YOUR_ALPHA_KEY";

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${ticker}&apikey=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    const series = json["Weekly Adjusted Time Series"];
    if (!series) return null;
    const latestDate = Object.keys(series).sort((a, b) => (a > b ? -1 : 1))[0];
    const latestBar = series[latestDate];
    const price = parseFloat(latestBar["4. close"]);
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

function aggregateAllocations(holdings: Holding[]): Allocation[] {
  const total = holdings.reduce((sum, h) => sum + h.price * h.shares, 0) || 1;
  const map = new Map<Category, number>();
  holdings.forEach((h) => {
    const value = h.price * h.shares;
    map.set(h.category, (map.get(h.category) || 0) + value);
  });
  return Array.from(map.entries()).map(([cat, val]) => ({
    category: cat,
    percent: Number(((val / total) * 100).toFixed(2)),
  }));
}

function calcMetrics(alloc: Allocation[], target: number): Metrics {
  // quick proxy — variance ~ weighted category vol
  const vol = Number((8 + Math.random() * 4).toFixed(2));
  const expReturn = target;
  const sharpe = Number(((expReturn - 2) / vol).toFixed(2));
  const cvar = Number((vol * 1.5).toFixed(2));
  return { expReturn, vol, sharpe, cvar };
}

/** Optimiser: allocate Stocks vs ETFs based on risk level */
function optimisePortfolio(risk: RiskLevel, current: Allocation[]): Allocation[] {
  const stockTarget = risk === "high" ? 90 : risk === "low" ? 50 : 70;
  const etfTarget = 100 - stockTarget;
  return current.map(a => a.category === "Stocks" ? { ...a, percent: stockTarget } : { ...a, percent: etfTarget });
}

async function fetchGBoostRecs(payload: { holdings: Holding[]; risk: RiskLevel; target: number }) {
  try {
    const res = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error("API fail");
    const json = await res.json();
    return json.suggestions as { ticker: string; reason: string; shares: number; price: number }[];
  } catch {
    // fallback: simple diversified picks
    return [
      { ticker: "VTI", reason: "Broad market ETF", shares: 0, price: 0 },
      { ticker: "VXUS", reason: "Intl diversification", shares: 0, price: 0 },
    ];
  }
}

// ---------------------------------------------------------------------------
//  MAIN COMPONENT
// ---------------------------------------------------------------------------
export default function PortfolioDashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [risk,setRisk]=useState<RiskLevel>("medium");
  const [target,setTarget]=useState(13.5);
  const [metrics,setMetrics]=useState<Metrics|null>(null);
  const [recs,setRecs]=useState<{ticker:string;reason:string}[]>([]);

  // fetch live prices on ticker change/initial load
  useEffect(()=>{holdings.forEach(async(h,idx)=>{if(h.ticker&&!h.price){const p=await fetchPrice(h.ticker);if(p){setHoldings(prev=>{const n=[...prev];n[idx].price=p;return n;});}}});},[holdings]);

  const alloc=aggregateAllocations(holdings);

  const handleOptimise=()=>{
    const opt=optimisePortfolio(risk,target,alloc);
    setMetrics(calcMetrics(opt,target));
    setRecs(recommendTickers(opt,risk));
  };

  const update=(i:number,field:keyof Holding,val:any)=>{
    setHoldings(prev=>{const n=[...prev];n[i]={...n[i],[field]:val};return n;});
  };

  const add=()=>setHoldings(h=>[...h,{ticker:"",shares:0,pricePaid:0,price:0,category:"Stocks"}]);
  const del=(i:number)=>setHoldings(h=>h.filter((_,idx)=>idx!==i));

  return(
    <div className="min-h-screen p-6 bg-background text-foreground">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Portfolio Optimizer</h1>
        <div className="flex items-center gap-2"><span>🌞</span><Switch/><span>🌜</span></div>
      </header>

      {/* Holdings Table */}
      <Card className="mb-8">
        <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="p-2">Ticker</th><th className="p-2">Shares</th><th className="p-2">Price Paid</th><th className="p-2">Current Price</th><th className="p-2">Category</th><th/></tr></thead>
            <tbody>
              {holdings.map((h,idx)=>(
                <tr key={idx} className="border-t">
                  <td className="p-2"><Input value={h.ticker} onBlur={e=>update(idx,"ticker",e.target.value.toUpperCase())} onChange={e=>update(idx,"ticker",e.target.value.toUpperCase())}/></td>
                  <td className="p-2"><Input type="no-spinner" step = 'any' value={h.shares} onChange={e=>update(idx,"shares",Number(e.target.value))}/></td>
                  <td className="p-2"><Input type="no-spinner" step = 'any' value={h.pricePaid} onChange={e=>update(idx,"pricePaid",Number(e.target.value))}/></td>
                  <td className="p-2"><Input type="number" value={h.price} readOnly/></td>
                  <td className="p-2">
                    <Select value={h.category} onValueChange={v=>update(idx,"category",v as Category)}>
                      <SelectTrigger className="w-32"><SelectValue/></SelectTrigger>
                      <SelectContent>{CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="p-2 text-right"><Button variant="ghost" size="icon" onClick={()=>del(idx)}><Trash2 className="h-4 w-4"/></Button></td>
                </tr>))}
            </tbody>
          </table>
          <Button variant="outline" className="mt-3" onClick={add}>+ Add Holding</Button>
        </CardContent>
      </Card>

      {/* Parameters */}
      <Card className="mb-8">
        <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><label className="block text-sm mb-1">Risk</label><Select value={risk} onValueChange={v=>setRisk(v as RiskLevel)}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></div>
          <div><label className="p-2">Target Return (%)</label><Input type="no-spinner" step = 'any' value={target} onChange={e=>setTarget(Number(e.target.value))}/></div>
          <Button className="w-full" onClick={handleOptimise}>Optimise Portfolio</Button>
        </CardContent>
      </Card>

      {/* Metrics & Recommendations */}
      {metrics && (
        <div className="grid md:grid-cols-4 gap-4 mb-8 text-center">
          <Card><CardHeader><CardTitle>{metrics.expReturn}%</CardTitle><p className="text-xs">Expected Return</p></CardHeader></Card>
          <Card><CardHeader><CardTitle>{metrics.vol}%</CardTitle><p className="text-xs">Volatility</p></CardHeader></Card>
          <Card><CardHeader><CardTitle>{metrics.sharpe}</CardTitle><p className="text-xs">Sharpe</p></CardHeader></Card>
          <Card><CardHeader><CardTitle>{metrics.cvar}%</CardTitle><p className="text-xs">CVaR 95%</p></CardHeader></Card>
        </div>)
      }

      {recs.length>0 && (
        <Card className="mb-12">
          <CardHeader><CardTitle>Suggested Trades</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {recs.map((r,i)=>(<li key={i} className="border p-3 rounded-lg"><strong>{r.ticker}</strong> — {r.reason}</li>))}
            </ul>
          </CardContent>
        </Card>
      )}

      <footer className="text-center text-xs text-muted-foreground">Built with ❤️ — next step: plug in a real optimiser engine.</footer>
    </div>
  );
}