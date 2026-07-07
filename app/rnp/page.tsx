"use client";

import { useEffect, useState } from "react";
import { Loader2, Table2 } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface Metric { field: string; label: string; kind: string; daily: (number | null)[]; total: number; forecast: number | null }
interface Sku { nm: number; art: string; name: string; img_url: string; metrics: Metric[] }
interface RnpTable { shop_label: string; sku_count: number; summary: Metric[]; skus: Sku[]; error?: string }

const fmtKind = (v: number | null, kind: string) => {
  if (v == null) return "—";
  if (kind === "money") return Math.round(v).toLocaleString("ru-RU");
  if (kind === "pct") return v + "%";
  return Math.round(v).toLocaleString("ru-RU");
};
const total = (m: Metric[], field: string) => m.find((x) => x.field === field)?.total ?? null;

// колонки SKU-таблицы РНП
const COLS: { field: string; label: string; kind: string }[] = [
  { field: "orders_count", label: "Заказы, шт", kind: "int" },
  { field: "orders_sum", label: "Заказы, ₽", kind: "money" },
  { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money" },
  { field: "buyout_pct", label: "Выкуп, %", kind: "pct" },
  { field: "ad_spent", label: "Реклама, ₽", kind: "money" },
  { field: "drr", label: "ДРР, %", kind: "pct" },
  { field: "margin_pct", label: "Маржа, %", kind: "pct" },
  { field: "stock", label: "Остаток", kind: "int" },
  { field: "turnover", label: "Оборач., дн", kind: "int" },
  { field: "gmroi", label: "GMROI, %", kind: "pct" },
];

function toneDrr(v: number | null) { if (v == null) return ""; return v <= 10 ? "text-emerald-600" : v <= 20 ? "text-amber-600" : "text-rose-600"; }
function toneMargin(v: number | null) { if (v == null) return ""; return v >= 20 ? "text-emerald-600" : v >= 10 ? "text-amber-600" : "text-rose-600"; }

export default function RnpPage() {
  const [cabId, setCabId] = useActiveCabinet("wb");
  const [win, setWin] = useState(30);
  const [data, setData] = useState<RnpTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (win - 1) * 86400000).toISOString().slice(0, 10);
    const shop = cabId || "all";
    fetch(`/api/rnp/${shop}/table?date_from=${from}&date_to=${to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: RnpTable) => { if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [cabId, win]);

  const sumCell = (field: string, kind: string) => fmtKind(total(data?.summary ?? [], field), kind);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Table2 className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">РНП по SKU</h1>
            <p className="text-xs text-gray-500">{data ? `${data.shop_label} · ${data.sku_count} SKU · ${win} дней` : "расход / выручка / маржа"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setWin(d)} className={`rounded px-3 py-1 text-xs font-semibold ${win === d ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{d}д</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data ? (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { f: "orders_sum", l: "Заказы, ₽", k: "money" },
                { f: "buyouts_sum", l: "Выкупы, ₽", k: "money" },
                { f: "buyout_pct", l: "Выкуп, %", k: "pct" },
                { f: "ad_spent", l: "Реклама, ₽", k: "money" },
                { f: "drr", l: "ДРР, %", k: "pct" },
                { f: "margin_pct", l: "Маржа, %", k: "pct" },
              ].map((s) => (
                <div key={s.f} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[11px] font-medium text-gray-500">{s.l}</div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">{sumCell(s.f, s.k)}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Артикул</th>
                    {COLS.map((c) => <th key={c.field} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.skus.map((s) => (
                    <tr key={s.nm} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2">
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.img_url} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                          <div className="min-w-0"><div className="truncate text-xs font-semibold">{s.art}</div><div className="truncate text-[10px] text-gray-400">{s.name}</div></div>
                        </div>
                      </td>
                      {COLS.map((c) => {
                        const v = total(s.metrics, c.field);
                        const tone = c.field === "drr" ? toneDrr(v) : c.field === "margin_pct" ? toneMargin(v) : "";
                        return <td key={c.field} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${tone}`}>{fmtKind(v, c.kind)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
