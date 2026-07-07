"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, ArrowUp, ArrowDown } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface Metric { key: string; label: string; kind: string; goodUp: boolean; current: number; previous: number; deltaPct: number; series: number[] }
interface TrendsData { window: number; current: { from: string; to: string }; previous: { from: string; to: string }; metrics: Metric[]; error?: string }

const fmt = (n: number, kind: string) => kind === "pct" ? n + "%" : Math.round(n).toLocaleString("ru-RU");

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const rng = max - min || 1;
  const w = 120, h = 36;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(" ");
  const color = up ? "#10b981" : "#ef4444";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function TrendsPage() {
  const [win, setWin] = useState(7);
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    fetch(`/api/trends?window=${win}${cabId ? `&cabinet=${cabId}` : ""}`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d) => {
      if (ignore) return;
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => { if (!ignore) setErr(String(e)); }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [win, cabId, cabReady]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><TrendingUp className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Динамика</h1>
            <p className="text-xs text-gray-500">{data ? `${data.current.from}→${data.current.to} vs ${data.previous.from}→${data.previous.to}` : "период к периоду"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setWin(d)} className={`rounded px-3 py-1 text-xs font-semibold ${win === d ? "bg-white text-blue-700 shadow" : "text-gray-500"}`}>{d}д vs {d}д</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.metrics.map((m) => {
              const good = m.deltaPct === 0 ? null : (m.goodUp ? m.deltaPct > 0 : m.deltaPct < 0);
              const dColor = good == null ? "text-gray-400" : good ? "text-emerald-600" : "text-red-600";
              return (
                <div key={m.key} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="text-xs font-medium text-gray-500">{m.label}</div>
                  <div className="mt-1 flex items-end justify-between">
                    <div className="text-2xl font-bold tabular-nums">{fmt(m.current, m.kind)}</div>
                    <div className={`flex items-center gap-0.5 text-sm font-semibold ${dColor}`}>
                      {m.deltaPct > 0 ? <ArrowUp className="h-4 w-4" /> : m.deltaPct < 0 ? <ArrowDown className="h-4 w-4" /> : null}
                      {Math.abs(m.deltaPct)}%
                    </div>
                  </div>
                  <div className="mt-2"><Spark data={m.series} up={good !== false} /></div>
                  <div className="mt-1 text-[11px] text-gray-400">было {fmt(m.previous, m.kind)}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </main>
    </div>
  );
}
