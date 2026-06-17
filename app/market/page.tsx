"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Query { word: string; wb_count: number; our_org: number | null; our_ad: number | null }
interface Pulse {
  ok?: boolean; error?: string; subject: string; cabinet: string; gran?: string; date_from?: string; date_to?: string;
  series: { bucket: string; niche: number; ours: number | null }[];
  niche_growth_pct: number | null; our_growth_pct: number | null; rel_growth_pct: number | null;
  share_pct: number | null; queries: Query[]; note?: string;
}

interface Niche { id: number; name: string; sku_count: number; cabinets: string[] }

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const wk = (s: string) => { const [, m, d] = s.split("-"); return `${d}.${m}`; };

export default function MarketPage() {
  const [wbCab] = useActiveCabinet("wb");
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheSel, setNicheSel] = useState(""); // "id:<num>" (авто-ниша) или "__custom"
  const [subject, setSubject] = useState(""); // путь предмета для custom
  const [gran, setGran] = useState<"week" | "day">("week");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preset, setPreset] = useState(""); // "7" | "30" | "90" | "" (свой/8 нед)
  const [data, setData] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(false);
  const [nichesLoading, setNichesLoading] = useState(true);
  const [err, setErr] = useState("");

  // авто-определение ниш кабинетов (1 раз)
  useEffect(() => {
    fetch("/api/market/niches", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const ns: Niche[] = j.niches ?? [];
      setNiches(ns);
      setNicheSel((cur) => cur || (ns.length ? `id:${ns[0].id}` : "__custom"));
    }).catch(() => setNicheSel("__custom")).finally(() => setNichesLoading(false));
  }, []);

  const load = useCallback(async () => {
    const isId = nicheSel.startsWith("id:");
    if (!isId && !subject.trim()) return;
    setLoading(true); setErr("");
    try {
      const nicheParam = isId ? `subject_id=${nicheSel.slice(3)}` : `subject=${encodeURIComponent(subject)}`;
      const period = dateFrom && dateTo ? `&date_from=${dateFrom}&date_to=${dateTo}` : "&weeks=8";
      const q = `${nicheParam}&gran=${gran}${period}${wbCab ? `&cabinet=${wbCab}` : ""}`;
      const r = await fetch(`/api/market/pulse?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Ошибка ${r.status}`); setData(null); }
      else setData(j);
    } catch (e) { setErr("Сеть: " + String(e)); }
    setLoading(false);
  }, [nicheSel, subject, wbCab, gran, dateFrom, dateTo]);

  useEffect(() => { if (nicheSel) load(); }, [load, nicheSel]);

  // Быстрый период: до вчера (MPStats не отдаёт сегодня), гранулярность по умолчанию ≤30д — день, иначе неделя.
  const applyPreset = (days: number, key: string) => {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    setDateTo(iso(Date.now() - 86400000));
    setDateFrom(iso(Date.now() - days * 86400000));
    setGran(days > 30 ? "week" : "day");
    setPreset(key);
  };
  const clearPeriod = () => { setDateFrom(""); setDateTo(""); setPreset(""); };

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
        <span className="text-xs font-semibold text-gray-500">🎯 Ниша:</span>
        <select value={nicheSel} onChange={(e) => setNicheSel(e.target.value)}
          className="max-w-[380px] rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          {nichesLoading && <option value="">определяю ниши кабинетов…</option>}
          {niches.map((n) => <option key={n.id} value={`id:${n.id}`}>{n.name} · {n.sku_count} SKU{n.cabinets.length > 1 ? ` · ${n.cabinets.length} каб` : ""}</option>)}
          <option value="__custom">— свой путь —</option>
        </select>
        {nicheSel === "__custom" && (
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Путь предмета WB (Игрушки/…/Игрушечное оружие)"
            className="min-w-[260px] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-xs" />
        )}
        <button onClick={load} disabled={loading} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">Показать</button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md bg-gray-100 p-0.5 text-xs font-semibold">
          <button onClick={() => setGran("week")} className={`rounded px-3 py-1 ${gran === "week" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}>По неделям</button>
          <button onClick={() => setGran("day")} className={`rounded px-3 py-1 ${gran === "day" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}>По дням</button>
        </div>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs font-semibold text-gray-500">Период:</span>
        <div className="inline-flex rounded-md bg-gray-100 p-0.5 text-xs font-semibold">
          {([["7", "7 дней"], ["30", "30 дней"], ["90", "90 дней"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => applyPreset(Number(k), k)}
              className={`rounded px-2.5 py-1 ${preset === k ? "bg-white text-violet-700 shadow-sm" : "text-gray-500"}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setPreset(""); }} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
        <span className="text-xs text-gray-400">—</span>
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPreset(""); }} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
        {(dateFrom || dateTo) && <button onClick={clearPeriod} className="text-xs text-gray-400 hover:text-violet-600 underline">сброс (8 нед)</button>}
        {!dateFrom && !dateTo && <span className="text-[11px] text-gray-400">пусто = последние 8 недель</span>}
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
                  <XAxis dataKey="bucket" tickFormatter={wk} fontSize={11} minTickGap={20} />
                  <YAxis yAxisId="l" tickFormatter={(v) => `${Math.round(v / 1e6)}М`} fontSize={11} width={38} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${Math.round(v / 1e3)}к`} fontSize={11} width={38} />
                  <Tooltip formatter={(v) => fmt(Number(v)) + " ₽"} labelFormatter={(l) => wk(String(l))} />
                  <Line yAxisId="l" type="monotone" dataKey="niche" stroke="#378ADD" strokeWidth={2} dot={false} name="Ниша" />
                  <Line yAxisId="r" type="monotone" dataKey="ours" stroke="#7C3AED" strokeWidth={2} dot={{ r: 2 }} name="Мы" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {data.queries.length > 0 && (
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-1 text-sm font-semibold text-gray-700">Топ-5 запросов ниши по спросу</div>
              <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#10b981" }} />🟢 мы в топе</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#f59e0b" }} />🟡 глубоко (&gt;100)</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#ef4444" }} />🔴 нас нет</span>
              </div>
              <div style={{ width: "100%", height: 40 + Math.min(5, data.queries.length) * 40 }}>
                <ResponsiveContainer>
                  <BarChart data={data.queries.slice(0, 5)} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}к`} fontSize={11} />
                    <YAxis type="category" dataKey="word" width={150} fontSize={11} tickFormatter={(s) => (String(s).length > 22 ? String(s).slice(0, 21) + "…" : String(s))} />
                    <Tooltip formatter={(v) => fmt(Number(v)) + " показов/мес"} />
                    <Bar dataKey="wb_count" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
                      {data.queries.slice(0, 5).map((q, i) => <Cell key={i} fill={queryColor(q)} />)}
                      <LabelList dataKey="wb_count" position="right" fontSize={11} fill="#666" formatter={(v) => fmt(Number(v))} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

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

// цвет столбца запроса по нашей позиции: нет нас → красный, глубоко → жёлтый, в топе → зелёный
function queryColor(q: { our_org: number | null; our_ad: number | null }): string {
  if (q.our_org == null && q.our_ad == null) return "#ef4444";
  if (q.our_org != null && q.our_org > 100) return "#f59e0b";
  return "#10b981";
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
