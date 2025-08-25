"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Sparkles, Sun, Moon, TrendingUp, Search } from "lucide-react";

/* ===========================
   Types
=========================== */
interface Holding {
  ticker: string;
  shares: number;
  pricePaid: number;
  price: number;
}
type RiskLevel = "low" | "medium" | "high";
interface Metrics { expReturn: number; vol: number; sharpe: number; cvar: number; }

/* ===========================
   Theme toggle (no extra deps)
=========================== */
function useThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("theme") as "light" | "dark") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  return { theme, setTheme };
}

/* ===========================
   Alpha Vantage helpers
=========================== */
const API_KEY = process.env.NEXT_PUBLIC_ALPHA_KEY || "YOUR_ALPHA_KEY";
const priceCache = new Map<string, number>();
const searchCache = new Map<string, Array<{ symbol: string; name: string }>>();
const norm = (t: string) => t.trim().toUpperCase();

// Prefer GLOBAL_QUOTE, fallback to WEEKLY_ADJUSTED
async function fetchPrice(tickerRaw: string): Promise<number | null> {
  const ticker = norm(tickerRaw);
  if (!ticker) return null;
  if (priceCache.has(ticker)) return priceCache.get(ticker)!;

  const tryGlobal = async () => {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${API_KEY}`;
    const r = await fetch(url);
    const j: any = await r.json();
    const px = parseFloat(j?.["Global Quote"]?.["05. price"] ?? j?.["Global Quote"]?.["08. previous close"]);
    return Number.isFinite(px) ? px : null;
  };

  const tryWeekly = async () => {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${encodeURIComponent(ticker)}&apikey=${API_KEY}`;
    const r = await fetch(url);
    const j: any = await r.json();
    const series = j?.["Weekly Adjusted Time Series"];
    if (!series || typeof series !== "object") return null;
    const latest = Object.keys(series).sort().pop();
    if (!latest) return null;
    const bar = series[latest];
    const px = parseFloat(bar["5. adjusted close"] ?? bar["4. close"]);
    return Number.isFinite(px) ? px : null;
  };

  try {
    const px = (await tryGlobal()) ?? (await tryWeekly());
    if (px != null) priceCache.set(ticker, px);
    return px ?? null;
  } catch {
    return null;
  }
}

async function searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (searchCache.has(q)) return searchCache.get(q)!;

  const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q)}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const json: any = await res.json();
  const best = (json?.bestMatches ?? []) as any[];
  const out = best.slice(0, 8).map((m) => ({
    symbol: String(m["1. symbol"] ?? "").toUpperCase(),
    name: String(m["2. name"] ?? ""),
  }));
  searchCache.set(q, out);
  return out;
}

/* ===========================
   Fancy Ticker Input with dropdown
=========================== */
function TickerInput({
  value,
  onSelect,
  onChange,
  placeholder = "e.g., AAPL",
}: {
  value: string;
  onSelect: (symbol: string) => void;  // fires when a suggestion is chosen
  onChange?: (text: string) => void;   // live text change (optional)
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<Array<{ symbol: string; name: string }>>([]);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => setQuery(value), [value]);

  // outside click closes
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // debounced search
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const q = query.trim();
      if (q.length < 2) {
        setItems([]);
        setOpen(false);
        return;
      }
      const res = await searchSymbols(q);
      setItems(res);
      setOpen(res.length > 0);
      setHighlight(0);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const choose = (sym: string) => {
    setOpen(false);
    onSelect(norm(sym));
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); onChange?.(e.target.value); }}
          onFocus={() => items.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
            if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter")     { e.preventDefault(); const pick = items[highlight]; if (pick) choose(pick.symbol); }
            if (e.key === "Escape")    { setOpen(false); }
          }}
          placeholder={placeholder}
        />
        <Search className="h-4 w-4 text-muted-foreground -ml-7 pointer-events-none" />
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-md border bg-background shadow-lg dark:border-zinc-800">
          <ul className="max-h-64 overflow-auto text-sm">
            {items.map((it, idx) => (
              <li
                key={it.symbol}
                className={[
                  "flex items-center justify-between px-3 py-2 cursor-pointer",
                  idx === highlight ? "bg-muted/60" : "hover:bg-muted/40"
                ].join(" ")}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); choose(it.symbol); }}
              >
                <span className="font-medium">{it.symbol}</span>
                <span className="text-xs text-muted-foreground ml-3 truncate">{it.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ===========================
   Placeholder portfolio math
=========================== */
function calcMetrics(target: number | ""): Metrics {
  const vol = Number((8 + Math.random() * 4).toFixed(2));
  const expReturn = typeof target === "number" ? target : 0;
  const sharpe = Number(((expReturn - 2) / (vol || 1)).toFixed(2));
  const cvar = Number((vol * 1.5).toFixed(2));
  return { expReturn, vol, sharpe, cvar };
}

async function fetchGBoostRecs(payload: {
  holdings: Holding[];
  risk: RiskLevel;
  target: number | "";
  budget?: number;
}) {
  try {
    const res = await fetch("/api/recommend-trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holdings: payload.holdings.map(h => ({ ...h, ticker: norm(h.ticker) })),
        targetReturn: payload.target === "" ? null : payload.target,
        budget: payload.budget ?? 0,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "API failed");
    return (json.recommendations ?? []).map((r: any) => ({
      ticker: String(r.ticker ?? ""),
      reason: r.reason ?? "High P(improve Sharpe)",
      shares: Number(r.shares ?? 0),
      price: Number(r.price ?? 0),
    }));
  } catch (e) {
    console.error("recommend-trades failed:", e);
    return [];
  }
}

/* ===========================
   Component
=========================== */
export default function PortfolioOptimizationDashboard() {
  const { theme, setTheme } = useThemeToggle();

  const [holdings, setHoldings] = useState<Holding[]>([
    { ticker: "", shares: 0, pricePaid: 0, price: 0 },
  ]);
  const [risk, setRisk] = useState<RiskLevel>("medium");
  const [target, setTarget] = useState<number | "">("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recs, setRecs] = useState<{ ticker: string; reason: string; price: number; shares: number }[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Reprice whenever tickers change
  const tickersKey = useMemo(() => holdings.map(h => norm(h.ticker)).join("|"), [holdings]);
  useEffect(() => {
    holdings.forEach((h, idx) => {
      const t = norm(h.ticker);
      if (!t) return;
      fetchPrice(t).then(px => {
        if (px == null) return;
        setHoldings(prev => {
          if (!prev[idx]) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], price: px };
          return next;
        });
      });
    });
  }, [tickersKey]);

  const handleOptimize = async () => {
    setMetrics(calcMetrics(target));
    setLoadingRecs(true);
    const suggestions = await fetchGBoostRecs({ holdings, risk, target });
    setRecs(suggestions);
    setLoadingRecs(false);
  };

  const setTicker = (i: number, sym: string) => {
    setHoldings(prev => {
      const next = [...prev];
      next[i] = { ...next[i], ticker: sym };
      return next;
    });
    // kick a fresh price fetch right away
    fetchPrice(sym).then(px => {
      if (px == null) return;
      setHoldings(prev => {
        const next = [...prev];
        if (next[i]) next[i] = { ...next[i], price: px };
        return next;
      });
    });
  };

  const update = (i: number, field: keyof Holding, val: any) => {
    setHoldings(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };
  const add = () => setHoldings(h => [...h, { ticker: "", shares: 0, pricePaid: 0, price: 0 }]);
  const del = (i: number) => setHoldings(h => h.filter((_, idx) => idx !== i));

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-white dark:from-zinc-900 dark:via-zinc-900 dark:to-black text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 text-white">
              <Sparkles size={18} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Portfolio Optimizer</h1>
              <p className="text-xs text-muted-foreground">
                Type a ticker and pick from the dropdown. Enter a target return and hit **Optimize** to see metrics and suggested trades.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span className="text-xs">{theme === "dark" ? "Light" : "Dark"} mode</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Holdings */}
        <Card className="shadow-sm border-purple-100 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              Holdings <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">beta</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-12 gap-3 text-xs font-medium text-muted-foreground">
              <div className="col-span-4">Ticker</div>
              <div className="col-span-2">Shares</div>
              <div className="col-span-3">Price Paid</div>
              <div className="col-span-3">Current Price</div>
            </div>

            {holdings.map((h, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-4">
                  <TickerInput
                    value={h.ticker}
                    onSelect={(sym) => setTicker(idx, sym)}
                    onChange={(txt) => update(idx, "ticker", txt)}
                  />
                </div>
                <div className="col-span-2">
                  <Input type="number" step="any"
                    value={h.shares}
                    onChange={(e) => update(idx, "shares", Number(e.target.value))}
                  />
                </div>
                <div className="col-span-3">
                  <Input type="number" step="any"
                    value={h.pricePaid}
                    onChange={(e) => update(idx, "pricePaid", Number(e.target.value))}
                  />
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <Input type="number" value={h.price || 0} readOnly />
                  <Button variant="ghost" size="icon" onClick={() => del(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="secondary" className="mt-2" onClick={add}>
              + Add Holding
            </Button>
          </CardContent>
        </Card>

        {/* Parameters */}
        <Card className="shadow-sm border-indigo-100 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              Parameters <TrendingUp size={18} className="text-indigo-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="block text-sm mb-1">Risk</label>
              <Select value={risk} onValueChange={(v) => setRisk(v as RiskLevel)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm mb-1">Target Return (%)</label>
              <Input
                type="number"
                step="any"
                value={target}
                onChange={(e) => {
                  const v = e.target.value;
                  setTarget(v === "" ? "" : Number(v));
                }}
                placeholder="e.g., 12"
              />
            </div>

            <div className="col-span-3">
              <Button className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                      onClick={handleOptimize}>
                Optimize Portfolio
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Metrics */}
        {metrics && (
          <div className="grid md:grid-cols-4 gap-4">
            <Card className="text-center border-purple-100 dark:border-zinc-800">
              <CardHeader><CardTitle className="text-2xl">{metrics.expReturn}%</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground -mt-3">Expected Return</CardContent>
            </Card>
            <Card className="text-center border-purple-100 dark:border-zinc-800">
              <CardHeader><CardTitle className="text-2xl">{metrics.vol}%</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground -mt-3">Volatility</CardContent>
            </Card>
            <Card className="text-center border-purple-100 dark:border-zinc-800">
              <CardHeader><CardTitle className="text-2xl">{metrics.sharpe}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground -mt-3">Sharpe</CardContent>
            </Card>
            <Card className="text-center border-purple-100 dark:border-zinc-800">
              <CardHeader><CardTitle className="text-2xl">{metrics.cvar}%</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground -mt-3">CVaR 95%</CardContent>
            </Card>
          </div>
        )}

        {/* Recommendations */}
        <Card className="shadow-sm border-indigo-100 dark:border-zinc-800">
          <CardHeader>
            <CardTitle>Suggested Trades</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRecs ? (
              <p className="text-sm text-muted-foreground">Scoring candidates…</p>
            ) : recs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suggestions yet — click “Optimize Portfolio”.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recs.map((r, i) => (
                  <li key={i} className="border rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{r.ticker}</Badge>
                      <span className="text-muted-foreground">{r.reason}</span>
                    </div>
                    <div className="text-right text-xs">
                      {r.price > 0 && <div>~${r.price.toFixed(2)}</div>}
                      {r.shares > 0 && <div>{r.shares} shares</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <footer className="py-8 text-center text-xs text-muted-foreground">
          Make some bread 💸
        </footer>
      </main>
    </div>
  );
}