"use client";

import { useEffect, useState } from "react";
import { Sigma } from "lucide-react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { DEFAULT_OPIU_BRAND_ID, OPIU_BRANDS } from "@/lib/opiu/constants";
import type { MarginRow } from "@/lib/opiu/marginByBarcode";

interface MarginResponse {
  rows: MarginRow[];
  period: { dateFrom: string; dateTo: string };
  brand: string;
  meta: { reportRows: number; skuCount: number; costsKnown: number; unattributedRows: number };
  error?: string;
}

function toLocalISODate(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toLocalISODate(d);
}
function defaultTo(): string {
  return toLocalISODate(new Date());
}

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;
const pct = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);

const COLUMNS: { key: keyof MarginRow; label: string; fmt: (row: MarginRow) => string }[] = [
  { key: "salesQty", label: "Продажи, шт", fmt: (r) => formatNumber(r.salesQty) },
  { key: "returnsQty", label: "Возвраты, шт", fmt: (r) => formatNumber(r.returnsQty) },
  { key: "netQty", label: "Итого продаж", fmt: (r) => formatNumber(r.netQty) },
  { key: "buyoutPct", label: "% выкупа", fmt: (r) => pct(r.buyoutPct) },
  { key: "revenueWithoutSpp", label: "Выручка без СПП", fmt: (r) => money(r.revenueWithoutSpp) },
  { key: "revenueAfterSpp", label: "Выручка после СПП", fmt: (r) => money(r.revenueAfterSpp) },
  { key: "forPay", label: "К перечислению продавцу", fmt: (r) => money(r.forPay) },
  { key: "commission", label: "Комиссия, руб", fmt: (r) => money(r.commission) },
  { key: "logistics", label: "Логистика, руб", fmt: (r) => money(r.logistics) },
  { key: "penalties", label: "Штрафы, руб", fmt: (r) => money(r.penalties) },
  { key: "additionalPayments", label: "Доплаты, руб", fmt: (r) => money(r.additionalPayments) },
  { key: "storage", label: "Хранение, руб", fmt: (r) => money(r.storage) },
  { key: "storagePct", label: "% хранения", fmt: (r) => pct(r.storagePct) },
  { key: "acceptance", label: "Платная приёмка, руб", fmt: (r) => money(r.acceptance) },
  { key: "transit", label: "Транзит, руб", fmt: (r) => money(r.transit) },
  { key: "totalPayout", label: "Итого к оплате, руб", fmt: (r) => money(r.totalPayout) },
  { key: "cost", label: "Себестоимость, руб", fmt: (r) => money(r.cost) },
  { key: "packaging", label: "Подготовка, руб", fmt: (r) => money(r.packaging) },
  { key: "marginalProfit", label: "Маржинальная прибыль, руб", fmt: (r) => money(r.marginalProfit) },
  { key: "marginPctBeforeTax", label: "Маржинальность без налога, %", fmt: (r) => pct(r.marginPctBeforeTax) },
  { key: "tax", label: "Налог, руб", fmt: (r) => money(r.tax) },
  { key: "netProfit", label: "Чистая прибыль, руб", fmt: (r) => money(r.netProfit) },
  { key: "netProfitPerUnit", label: "Чистая прибыль на ед, руб", fmt: (r) => (r.netProfitPerUnit == null ? "—" : money(r.netProfitPerUnit)) },
  { key: "netMarginPct", label: "Маржа с налогом, %", fmt: (r) => pct(r.netMarginPct) },
  { key: "adSpend", label: "Реклама, руб", fmt: (r) => money(r.adSpend) },
];

export function MarginByArticlePage() {
  const [brand, setBrand] = useState(DEFAULT_OPIU_BRAND_ID);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<MarginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!from || !to || from > to) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom: from, dateTo: to, brand });
    fetch(`/api/opiu/margin?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as MarginResponse;
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(setData)
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [brand, from, to]);

  const totals = data?.rows.reduce(
    (acc, r) => {
      for (const col of COLUMNS) {
        const v = r[col.key];
        if (typeof v === "number") acc[col.key] = (acc[col.key] ?? 0) + v;
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sigma className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Маржа по артикулам (артикул ВБ)</h1>
            <p className="text-xs text-gray-500">
              По факту финотчёта WB, сгруппировано по баркоду — та же методология, что в ОПиУ
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
            >
              {OPIU_BRANDS.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
            />
            <span className="text-gray-400">–</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[110rem] px-3 py-6 sm:px-6">
        {from > to && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Дата «по» не может быть раньше даты «с»
          </div>
        )}
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            Считаю маржу по артикулам…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : data && data.rows.length ? (
          <>
            <p className="mb-3 text-xs text-gray-400">
              Строк отчёта: {data.meta.reportRows} · SKU: {data.meta.skuCount} · себестоимостей в базе: {data.meta.costsKnown}
              {" · "}Налог — 6% с выручки после СПП (как в таблице) · «Реклама» — справочно, не вычтена из прибыли
              {data.meta.unattributedRows > 0 && (
                <> · <span className="text-amber-600">не привязано ни к товару, ни к nm_id: {data.meta.unattributedRows} строк отчёта</span></>
              )}
            </p>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Артикул</th>
                    {COLUMNS.map((col) => (
                      <th key={col.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 bg-violet-50 font-semibold">
                    <td className="sticky left-0 z-10 bg-violet-50 px-3 py-2">Итого</td>
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {typeof totals?.[col.key] === "number"
                          ? col.key.toString().toLowerCase().includes("pct")
                            ? "—"
                            : money(totals[col.key])
                          : "—"}
                      </td>
                    ))}
                  </tr>
                  {data.rows.map((row) => (
                    <tr key={row.barcode || `nm-${row.nmId}`} className="group border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                          <WbProductImage nm={row.nmId} className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold">{row.article || row.nmId}</div>
                            <div className="truncate text-[10px] text-gray-400">
                              {row.barcode ? `баркод ${row.barcode}` : "без баркода (WB не привязал к размеру)"}
                            </div>
                          </div>
                        </div>
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{col.fmt(row)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            Нет данных за выбранный период
          </div>
        )}
      </main>
    </div>
  );
}
