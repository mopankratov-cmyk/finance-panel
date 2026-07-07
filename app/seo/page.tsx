"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface SeoSku {
  nm: number; art: string; name: string; img_url: string;
  shows_window: number; ctr_window: number | null; cart_window: number;
  cv_cart_window: number | null; cv_order_window: number | null;
  orders_count_window: number; orders_sum_window: number;
  drr_window: number | null; margin_before_drr_window: number | null;
  stock: number; turnover_4d: number | null;
}
interface SeoData { skus: SeoSku[]; metrics_period: string; count: number }

const num = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("ru-RU"));
const pc = (v: number | null) => (v == null ? "—" : v + "%");
const toneDrr = (v: number | null) => (v == null ? "" : v <= 10 ? "text-emerald-600" : v <= 20 ? "text-amber-600" : "text-rose-600");
const toneMargin = (v: number | null) => (v == null ? "" : v >= 20 ? "text-emerald-600" : v >= 10 ? "text-amber-600" : "text-rose-600");

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
  const [data, setData] = useState<SeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    fetch(`/api/seo/skus?window=${win}${cabId ? `&cabinet=${cabId}` : ""}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: SeoData & { error?: string }) => { if (ignore) return; if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => { if (!ignore) setErr(String(e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabId, win, cabReady]);

  const cell = (s: SeoSku, key: keyof SeoSku, kind: string) => {
    const v = s[key] as number | null;
    if (kind === "pct") return pc(v);
    if (kind === "drr") return <span className={toneDrr(v)}>{pc(v)}</span>;
    if (kind === "margin") return <span className={toneMargin(v)}>{pc(v)}</span>;
    return num(v);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Search className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">SEO / Воронка</h1>
            <p className="text-xs text-gray-500">{data ? `${data.count} SKU · ${data.metrics_period}` : "показы → CTR → корзина → заказ"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[1, 7, 30].map((d) => (
                <button key={d} onClick={() => setWin(d)} className={`rounded px-3 py-1 text-xs font-semibold ${win === d ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{d === 1 ? "вчера" : d + "д"}</button>
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
        ) : data && data.skus.length ? (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Артикул</th>
                  {COLS.map((c) => <th key={String(c.key)} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{c.label}</th>)}
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
