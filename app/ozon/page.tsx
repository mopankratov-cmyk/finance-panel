"use client";

import { useEffect, useState } from "react";
import { Loader2, Filter, Calculator, Package, TrendingDown } from "lucide-react";

type Tab = "funnel" | "unit" | "stocks";
const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("ru-RU"));
const pct = (n: number | null | undefined) => (n == null ? "—" : n + "%");

interface FunnelRow { sku: string; name: string; hits_view: number; hits_tocart: number; ordered_units: number; revenue: number; cr_cart: number | null; cr_order: number | null }
interface UnitRow { art: string; name: string; price: number; cost: number; commission_pct: number; commission_rub: number; logistics: number; acquiring: number; profit: number; margin: number | null }
interface StockRow { art: string; name: string; free: number; reserved: number; byWh: Record<string, number> }

export default function OzonPage() {
  const [tab, setTab] = useState<Tab>("funnel");
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noCab, setNoCab] = useState(false);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [unit, setUnit] = useState<UnitRow[]>([]);
  const [stocks, setStocks] = useState<{ rows: StockRow[]; warehouses: string[]; totalFree: number }>({ rows: [], warehouses: [], totalFree: 0 });
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true); setErr(null); setNoCab(false);
    const url = tab === "funnel" ? `/api/ozon/analytics?days=${days}` : tab === "unit" ? "/api/ozon/unit" : "/api/ozon/stocks";
    fetch(url, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.noCabinet) { setNoCab(true); return; }
      if (d.error) { setErr(d.error); return; }
      if (tab === "funnel") setFunnel(d.rows ?? []);
      else if (tab === "unit") setUnit(d.rows ?? []);
      else setStocks({ rows: d.rows ?? [], warehouses: d.warehouses ?? [], totalFree: d.totalFree ?? 0 });
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [tab, days]);

  const flt = <T extends { name: string; art?: string; sku?: string }>(rows: T[]) => {
    const s = q.toLowerCase().trim();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s) || (r.art || r.sku || "").toLowerCase().includes(s)) : rows;
  };

  const TABS: { key: Tab; label: string; icon: typeof Filter }[] = [
    { key: "funnel", label: "Воронка", icon: Filter },
    { key: "unit", label: "Юнит-экономика", icon: Calculator },
    { key: "stocks", label: "Остатки", icon: Package },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-blue-700 text-xs font-extrabold text-white">OZ</div>
        <h1 className="text-2xl font-bold text-gray-900">Ozon Аналитика</h1>
        <a href="/losses" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
          <TrendingDown className="h-3.5 w-3.5" /> Где теряем (Ozon)
        </a>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-white text-sky-700 shadow" : "text-gray-500 hover:text-gray-700"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        {tab === "funnel" && (
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded px-2.5 py-1 text-xs font-semibold ${days === d ? "bg-white text-sky-700 shadow" : "text-gray-500"}`}>{d} дн</button>
            ))}
          </div>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по артикулу/названию"
          className="ml-auto w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none" />
      </div>

      {noCab ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          Нет подключённого Ozon-кабинета → <a href="/cabinets" className="font-semibold underline">добавить</a>
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Ozon: {err}</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
          {tab === "funnel" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>{["Товар", "Показы", "В корзину", "CR корзина", "Заказы шт", "CR заказ", "Выручка ₽"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {flt(funnel).map((r) => (
                  <tr key={r.sku} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><div className="max-w-md truncate text-gray-800">{r.name}</div><div className="text-[11px] text-gray-400">sku {r.sku}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hits_view)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hits_tocart)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pct(r.cr_cart)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.ordered_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pct(r.cr_order)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "unit" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>{["Артикул", "Цена ₽", "Себес ₽", "Комиссия %", "Комиссия ₽", "Логистика ₽", "Эквайринг ₽", "Прибыль/ед ₽", "Маржа %"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {flt(unit).map((r) => (
                  <tr key={r.art} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.cost === 0 ? "text-amber-500" : ""}`}>{r.cost === 0 ? "нет" : fmt(r.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.commission_pct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.commission_rub)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.logistics)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.acquiring)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(r.profit)}</td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums ${(r.margin ?? 0) < 0 ? "text-red-600" : (r.margin ?? 0) < 15 ? "text-amber-600" : "text-emerald-700"}`}>{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "stocks" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Товар</th>
                  <th className="px-3 py-2 text-right">Свободно</th>
                  <th className="px-3 py-2 text-right">Резерв</th>
                  <th className="px-3 py-2 text-left">Топ складов</th>
                </tr>
              </thead>
              <tbody>
                {flt(stocks.rows).map((r) => {
                  const top = Object.entries(r.byWh).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
                  return (
                    <tr key={r.art} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.free < 10 ? "text-red-600" : ""}`}>{fmt(r.free)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.reserved)}</td>
                      <td className="px-3 py-2 text-[11px] text-gray-500">{top.map(([w, v]) => `${w.replace(/_РФЦ$/, "")} ${v}`).join(" · ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
