"use client";

import { useEffect, useState } from "react";
import { Loader2, CalendarRange, Check } from "lucide-react";
import { LoadingBanner, SkeletonKpiRow, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";

interface Pl { orders: number[]; norms: Record<string, unknown>; sku_orders: Record<string, number[]> }
interface Sku { art: string; name: string; cat: string; wb_stock: number }
interface SkusData { skus: Sku[]; count: number; wb_stock_date: string }

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const NOW_YEAR = 2026; // panel-fixed base year (см. currentDate); переключатель ±

export default function PlanningPage() {
  const [year, setYear] = useState(NOW_YEAR);
  const [pl, setPl] = useState<Pl | null>(null);
  const [skus, setSkus] = useState<SkusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    setLoading(true); setErr(null); setSaved(false);
    Promise.all([
      fetch(`/api/planning/pl?year=${year}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/planning/skus`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([p, s]: [Pl & { error?: string }, SkusData]) => {
      if (p.error) setErr(p.error); else { setPl({ orders: p.orders, norms: p.norms, sku_orders: p.sku_orders }); setSkus(s); }
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [year]);

  const setMonth = (i: number, v: string) => {
    if (!pl) return;
    const orders = [...pl.orders];
    orders[i] = Number(v) || 0;
    setPl({ ...pl, orders });
    setSaved(false);
  };

  const save = async () => {
    if (!pl) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/planning/pl`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, orders: pl.orders, norms: pl.norms, sku_orders: pl.sku_orders }),
      });
      const j = await res.json();
      if (j.ok) { setSaved(true); } else setErr(j.error || "Ошибка сохранения");
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  const planTotal = pl ? pl.orders.reduce((a, v) => a + v, 0) : 0;
  const stockTotal = skus ? skus.skus.reduce((a, s) => a + s.wb_stock, 0) : 0;

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><CalendarRange className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Планирование закупок</h1>
            <p className="text-xs text-gray-500">{skus ? `${skus.count} SKU · остаток WB на ${skus.wb_stock_date}` : "годовой план заказов"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md bg-gray-100 p-0.5">
              <button onClick={() => setYear((y) => y - 1)} className="rounded px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-white">‹</button>
              <span className="px-2 text-sm font-bold tabular-nums">{year}</span>
              <button onClick={() => setYear((y) => y + 1)} className="rounded px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-white">›</button>
            </div>
            <button onClick={save} disabled={saving || !pl} className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
              {saved ? "Сохранено" : "Сохранить план"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="план и остатки" />
            <SkeletonKpiRow count={3} />
            <SkeletonTableRows rows={6} cols={3} />
          </>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : pl ? (
          <>
            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-sm font-semibold">План заказов по месяцам, шт</div>
                <div className="text-sm text-gray-500">итого <span className="font-bold tabular-nums text-gray-900">{nf(planTotal)}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                {MONTHS.map((m, i) => (
                  <label key={m} className="flex flex-col gap-1">
                    <span className="text-[11px] text-gray-400">{m}</span>
                    <input type="number" min={0} value={pl.orders[i] || 0} onChange={(e) => setMonth(i, e.target.value)}
                      className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm tabular-nums focus:border-violet-400 focus:outline-none" />
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-sm font-semibold">Остатки по SKU</div>
              <div className="text-xs text-gray-500">итого на WB <span className="font-bold tabular-nums text-gray-900">{nf(stockTotal)}</span> шт</div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="px-3 py-2 font-semibold">Артикул</th>
                    <th className="px-3 py-2 font-semibold">Категория</th>
                    <th className="px-3 py-2 text-right font-semibold">Остаток WB</th>
                  </tr>
                </thead>
                <tbody>
                  {(skus?.skus ?? []).map((s) => (
                    <tr key={s.art} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2"><div className="text-xs font-semibold">{s.art}</div><div className="truncate text-[10px] text-gray-400">{s.name}</div></td>
                      <td className="px-3 py-2 text-xs text-gray-500">{s.cat}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(s.wb_stock)}</td>
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
