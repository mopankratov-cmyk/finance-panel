"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Query { word: string; wb_count: number; our_org: number | null; our_ad: number | null }
interface Pulse {
  ok?: boolean; error?: string; subject: string; cabinet: string; weeks: number;
  series: { week: string; niche: number; ours: number | null }[];
  niche_growth_pct: number | null; our_growth_pct: number | null; rel_growth_pct: number | null;
  share_pct: number | null; queries: Query[]; note?: string;
}

const PRESETS = [
  { label: "Водные пистолеты (Игрушки)", path: "Игрушки/Игрушечное оружие и аксессуары/Игрушечное оружие" },
  { label: "Водные пистолеты (Детям)", path: "Детям/Подарки детям/Игрушки/Игрушечное оружие" },
];

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const wk = (s: string) => { const [, m, d] = s.split("-"); return `${d}.${m}`; };

export default function MarketPage() {
  const [wbCab] = useActiveCabinet("wb");
  const [subject, setSubject] = useState(PRESETS[0].path);
  const [data, setData] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!subject.trim()) return;
    setLoading(true); setErr("");
    try {
      const q = `subject=${encodeURIComponent(subject)}&weeks=8${wbCab ? `&cabinet=${wbCab}` : ""}`;
      const r = await fetch(`/api/market/pulse?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Ошибка ${r.status}`); setData(null); }
      else setData(j);
    } catch (e) { setErr("Сеть: " + String(e)); }
    setLoading(false);
  }, [subject, wbCab]);

  useEffect(() => { load(); }, [load]);

  const rel = data?.rel_growth_pct;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <Target className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Рынок</h1>
          <p className="text-sm text-gray-500">Ниша растёт ↔ как растём мы · по данным MPStats (тренд, не абсолют)</p>
        </div>
        <div className="ml-auto"><CabinetSwitcher mp="wb" accent="violet" onChange={() => load()} /></div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">Ниша:</span>
        <select value={PRESETS.some((p) => p.path === subject) ? subject : "__custom"} onChange={(e) => { if (e.target.value !== "__custom") setSubject(e.target.value); }}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          {PRESETS.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
          <option value="__custom">— свой путь —</option>
        </select>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Путь предмета WB"
          className="min-w-[280px] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-xs" />
        <button onClick={load} disabled={loading} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">Показать</button>
      </div>

      {loading && <div className="py-16 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}
      {err && !loading && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}{err.includes("MPSTATS") && <span className="block text-xs text-red-500 mt-1">Добавьте MPSTATS_TOKEN в переменные окружения Vercel.</span>}</div>}

      {data && !loading && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Рост ниши" value={pct(data.niche_growth_pct)} tone={tone(data.niche_growth_pct)} />
            <Card label="Наш рост" value={pct(data.our_growth_pct)} tone={tone(data.our_growth_pct)} />
            <Card label="Мы vs ниша" value={pct(rel)} tone={tone(rel)} hint={rel != null ? (rel >= 0 ? "отжимаем долю" : "отстаём от рынка") : ""} big />
            <Card label="Наша доля в нише" value={data.share_pct != null ? `${data.share_pct}%` : "—"} tone="neutral" hint={`кабинет: ${data.cabinet}`} />
          </div>

          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#378ADD" }} />Ниша, выручка ₽ (лев.)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5" style={{ borderTop: "2px solid #7C3AED" }} />Мы, выручка ₽ (прав.)</span>
            </div>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.series} margin={{ top: 6, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="week" tickFormatter={wk} fontSize={11} />
                  <YAxis yAxisId="l" tickFormatter={(v) => `${Math.round(v / 1e6)}М`} fontSize={11} width={38} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${Math.round(v / 1e3)}к`} fontSize={11} width={38} />
                  <Tooltip formatter={(v) => fmt(Number(v)) + " ₽"} labelFormatter={(l) => wk(String(l))} />
                  <Line yAxisId="l" type="monotone" dataKey="niche" stroke="#378ADD" strokeWidth={2} dot={false} name="Ниша" />
                  <Line yAxisId="r" type="monotone" dataKey="ours" stroke="#7C3AED" strokeWidth={2} dot={{ r: 2 }} name="Мы" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-gray-700">Запросы растут ↔ наши позиции</div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500">
                <th className="py-1.5 font-normal">Запрос</th>
                <th className="py-1.5 font-normal">Спрос (WB)</th>
                <th className="py-1.5 font-normal">Орг.</th>
                <th className="py-1.5 font-normal">Рекл.</th>
                <th className="py-1.5 font-normal">Приоритет</th>
              </tr></thead>
              <tbody>
                {data.queries.map((q) => {
                  const absent = q.our_org == null && q.our_ad == null;
                  const deep = q.our_org != null && q.our_org > 100;
                  return (
                    <tr key={q.word} className="border-t border-gray-100">
                      <td className="py-2">{q.word}</td>
                      <td className="py-2 text-gray-600">{fmt(q.wb_count)}</td>
                      <td className={`py-2 ${q.our_org == null ? "text-red-500" : q.our_org > 100 ? "text-amber-600" : "text-emerald-600"}`}>{q.our_org ?? "—"}</td>
                      <td className="py-2 text-gray-500">{q.our_ad ?? "—"}</td>
                      <td className="py-2">
                        {absent ? <Tag c="red">🔴 нас нет</Tag> : deep ? <Tag c="amber">🟡 глубоко</Tag> : <Tag c="green">🟢 в топе</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-400">{data.note}</p>
          </div>
        </>
      )}
    </div>
  );
}

function pct(v: number | null | undefined) { return v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`; }
function tone(v: number | null | undefined): "pos" | "neg" | "neutral" { if (v == null) return "neutral"; return v >= 0 ? "pos" : "neg"; }

function Card({ label, value, tone, hint, big }: { label: string; value: string; tone: "pos" | "neg" | "neutral"; hint?: string; big?: boolean }) {
  const col = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : "text-gray-900";
  return (
    <div className={`rounded-lg bg-gray-50 p-3 ${big ? "ring-2 ring-violet-200" : ""}`}>
      <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">{label}{tone === "pos" && <TrendingUp className="h-3 w-3 text-emerald-500" />}{tone === "neg" && <TrendingDown className="h-3 w-3 text-red-500" />}</div>
      <div className={`text-2xl font-semibold ${col}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

function Tag({ c, children }: { c: "red" | "amber" | "green"; children: React.ReactNode }) {
  const cls = c === "red" ? "bg-red-100 text-red-700" : c === "amber" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
