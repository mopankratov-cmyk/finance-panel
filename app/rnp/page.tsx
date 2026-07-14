"use client";

import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonKpiRow, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { useSort, sortGlyph } from "@/lib/useSort";
import { heat } from "@/lib/analytics/heat";
import { WbProductImage } from "@/components/wb/WbProductImage";

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
  { field: "views", label: "Показы", kind: "int" },
  { field: "clicks", label: "Клики", kind: "int" },
  { field: "ctr", label: "CTR, %", kind: "pct" },
  { field: "cart", label: "В корзину", kind: "int" },
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

// [className, glyph] — глиф даёт сигнал не только цветом (важно для дальтоников/ч-б экранов).
function toneDrr(v: number | null): [string, string] { if (v == null) return ["", ""]; return v <= 10 ? ["text-emerald-600", ""] : v <= 20 ? ["text-amber-600", "△ "] : ["text-rose-600", "▲ "]; }
function toneMargin(v: number | null): [string, string] { if (v == null) return ["", ""]; return v >= 20 ? ["text-emerald-600", ""] : v >= 10 ? ["text-amber-600", "△ "] : ["text-rose-600", "▲ "]; }

export default function RnpPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [win, setWin] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<RnpTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    const to = customTo || new Date().toISOString().slice(0, 10);
    const from = customFrom || new Date(Date.now() - (win - 1) * 86400000).toISOString().slice(0, 10);
    const shop = cabId || "all";
    fetch(`/api/rnp/${shop}/table?date_from=${from}&date_to=${to}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: RnpTable) => { if (ignore) return; if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => { if (!ignore) setErr(String(e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabId, win, cabReady, customFrom, customTo]);

  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const filtered = filterByCategory(data?.skus ?? [], (s) => s.art, byArticle, category);
  const { sorted: skus, sortField, sortDir, toggleSort } = useSort(filtered, (s, field) =>
    field === "art" ? s.art : total(s.metrics, field));

  const sumCell = (field: string, kind: string) => fmtKind(total(data?.summary ?? [], field), kind);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Table2 className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">РНП по SKU</h1>
            <p className="text-xs text-gray-500">{data ? `${data.shop_label} · ${data.sku_count} SKU · ${win} дней` : "расход / выручка / маржа"}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={categories} value={category} onChange={setCategory} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => { setWin(d); setCustomFrom(""); setCustomTo(""); }} className={`rounded px-3 py-1 text-xs font-semibold ${win === d && !customFrom ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{d}д</button>
              ))}
            </div>
            <DateRangePicker from={customFrom} to={customTo} onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="РНП по SKU" />
            <SkeletonKpiRow count={6} />
            <SkeletonTableRows rows={10} cols={13} />
          </>
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
                    <th onClick={() => toggleSort("art")} className="sticky left-0 z-10 cursor-pointer select-none bg-white px-3 py-2 font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] hover:text-violet-700">Артикул{sortGlyph(sortField === "art", sortDir)}</th>
                    {COLS.map((c) => (
                      <th key={c.field} onClick={() => toggleSort(c.field)} className="cursor-pointer select-none px-3 py-2 text-right font-semibold whitespace-nowrap hover:text-violet-700">
                        {c.label}{sortGlyph(sortField === c.field, sortDir)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s) => (
                    <tr key={s.nm} className="group border-b border-gray-100 last:border-0 hover:bg-violet-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-violet-50">
                        <div className="flex items-center gap-2">
                          <WbProductImage nm={s.nm} src={s.img_url} className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" />
                          <div className="min-w-0"><div className="truncate text-xs font-semibold">{s.art}</div><div className="truncate text-[10px] text-gray-400">{s.name}</div></div>
                        </div>
                      </td>
                      {COLS.map((c) => {
                        const v = total(s.metrics, c.field);
                        const [tone, glyph] = c.field === "drr" ? toneDrr(v) : c.field === "margin_pct" ? toneMargin(v) : ["", ""];
                        const heatField = c.field === "margin_pct" ? "margin" : c.field === "drr" ? "drr" : "";
                        return <td key={c.field} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${tone}`} style={heatField ? { background: heat(heatField, v) } : undefined}>{glyph}{fmtKind(v, c.kind)}</td>;
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
