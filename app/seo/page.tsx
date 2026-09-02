"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { CategoryFilter, categoriesOnScreen, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { useSort, sortGlyph } from "@/lib/useSort";
import { WbProductImage } from "@/components/wb/WbProductImage";

interface SeoSku {
  nm: number; art: string; name: string; img_url: string;
  shows_window: number; ctr_window: number | null; cart_window: number;
  cv_cart_window: number | null; cv_order_window: number | null;
  orders_count_window: number; orders_sum_window: number;
  drr_window: number | null; margin_before_drr_window: number | null;
  stock: number; turnover_4d: number | null;
  rating: number | null; reviews: number | null;
}
interface SeoData { skus: SeoSku[]; metrics_period: string; count: number }

const num = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("ru-RU"));
const pc = (v: number | null) => (v == null ? "—" : v + "%");
// [className, glyph] — глиф даёт сигнал не только цветом (важно для дальтоников/ч-б экранов).
const toneDrr = (v: number | null): [string, string] => (v == null ? ["", ""] : v <= 10 ? ["text-emerald-600", ""] : v <= 20 ? ["text-amber-600", "△ "] : ["text-rose-600", "▲ "]);
const toneMargin = (v: number | null): [string, string] => (v == null ? ["", ""] : v >= 20 ? ["text-emerald-600", ""] : v >= 10 ? ["text-amber-600", "△ "] : ["text-rose-600", "▲ "]);

const COLS: { key: keyof SeoSku; label: string; kind: "num" | "pct" | "drr" | "margin" }[] = [
  { key: "shows_window", label: "Показы", kind: "num" },
  { key: "ctr_window", label: "CTR", kind: "pct" },
  { key: "cart_window", label: "В корзину", kind: "num" },
  { key: "cv_cart_window", label: "CV корзины", kind: "pct" },
  { key: "cv_order_window", label: "CV заказа", kind: "pct" },
  { key: "orders_count_window", label: "Заказы, шт", kind: "num" },
  { key: "orders_sum_window", label: "Выручка, ₽", kind: "num" },
  { key: "drr_window", label: "ДРР, %", kind: "drr" },
  { key: "margin_before_drr_window", label: "Маржа, %", kind: "margin" },
  { key: "stock", label: "Остаток", kind: "num" },
];

export default function SeoPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [win, setWin] = useState(7);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<SeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    const range = customFrom && customTo ? `&date_from=${customFrom}&date_to=${customTo}` : "";
    fetch(`/api/seo/skus?window=${win}${cabId ? `&cabinet=${cabId}` : ""}${range}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: SeoData & { error?: string }) => { if (ignore) return; if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => { if (!ignore) setErr(String(e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabId, win, cabReady, customFrom, customTo]);

  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const filtered = filterByCategory(data?.skus ?? [], (s) => s.art, byArticle, category);
  const catOptions = categoriesOnScreen(data?.skus ?? [], (s) => s.art, byArticle, categories);
  const { sorted: skus, sortField, sortDir, toggleSort } = useSort(filtered, (s, field) =>
    field === "art" ? s.art : (s[field as keyof SeoSku] as number | null));

  const cell = (s: SeoSku, key: keyof SeoSku, kind: string) => {
    const v = s[key] as number | null;
    if (kind === "pct") return pc(v);
    if (kind === "drr") { const [cls, glyph] = toneDrr(v); return <span className={cls}>{glyph}{pc(v)}</span>; }
    if (kind === "margin") { const [cls, glyph] = toneMargin(v); return <span className={cls}>{glyph}{pc(v)}</span>; }
    return num(v);
  };

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Search className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">SEO / Воронка</h1>
            <p className="text-xs text-gray-500">{data ? `${category ? `${filtered.length} из ${data.count}` : data.count} SKU · ${data.metrics_period}` : "показы → CTR → корзина → заказ"}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={catOptions.categories} hasUncategorized={catOptions.hasUncategorized} value={category} onChange={setCategory} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[1, 7, 30].map((d) => (
                <button key={d} onClick={() => { setWin(d); setCustomFrom(""); setCustomTo(""); }} className={`rounded px-3 py-1 text-xs font-semibold ${win === d && !customFrom ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{d === 1 ? "вчера" : d + "д"}</button>
              ))}
            </div>
            <DateRangePicker from={customFrom} to={customTo} onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="SEO-воронка" />
            <SkeletonTableRows rows={10} cols={8} />
          </>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data && skus.length ? (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th onClick={() => toggleSort("art")} className="sticky left-0 z-10 cursor-pointer select-none bg-white px-3 py-2 font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] hover:text-violet-700">Артикул{sortGlyph(sortField === "art", sortDir)}</th>
                  <th onClick={() => toggleSort("rating")} className="cursor-pointer select-none px-3 py-2 text-right font-semibold whitespace-nowrap hover:text-violet-700">Рейтинг{sortGlyph(sortField === "rating", sortDir)}</th>
                  {COLS.map((c) => (
                    <th key={String(c.key)} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none px-3 py-2 text-right font-semibold whitespace-nowrap hover:text-violet-700">
                      {c.label}{sortGlyph(sortField === c.key, sortDir)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skus.map((s) => (
                  <tr key={s.nm} className="group border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-gray-50">
                      <div className="flex items-center gap-2">
                        <WbProductImage nm={s.nm} src={s.img_url} className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" />
                        <div className="min-w-0"><div className="truncate text-xs font-semibold">{s.art}</div><div className="truncate text-[10px] text-gray-400">{s.name}</div></div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-gray-500">
                      {s.rating != null ? <>★ {s.rating}{s.reviews != null && <span className="text-gray-400"> ({s.reviews})</span>}</> : "—"}
                    </td>
                    {COLS.map((c) => <td key={String(c.key)} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{cell(s, c.key, c.kind)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">Нет данных воронки за период.</div>
        )}
      </main>
    </div>
  );
}
