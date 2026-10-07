"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, Sigma } from "lucide-react";
import { formatNumber } from "@/lib/analytics/format";
import type { OzonMarginRow, OzonMarginTotals } from "@/lib/ozon/marginBySku";
import type { OzonMarginCheck } from "@/lib/ozon/marginCheck";

interface Cabinet {
  id: string;
  name: string;
  marketplace?: string;
}

interface MarginResponse {
  rows: OzonMarginRow[];
  totals: OzonMarginTotals;
  check: OzonMarginCheck;
  missingCost: string[];
  period: { dateFrom: string; dateTo: string };
  meta: { accrualRows: number; skuCount: number; catalogIncomplete: boolean };
  error?: string;
}

function toLocalISODate(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return toLocalISODate(d);
}
function defaultTo(): string {
  return toLocalISODate(new Date());
}

const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const SECTION_LABELS = { logistics: "Логистика", other: "Прочие удержания", ads: "Реклама" } as const;
const pct = (value: number | null) => (value == null ? "—" : `${value.toFixed(2)}%`);

type Cell = { key: string; label: string; fmt: (r: OzonMarginRow | OzonMarginTotals) => string };

// Порядок и названия — как на вкладке «Маржа по артикулам» эталонной таблицы.
const COLUMNS: Cell[] = [
  { key: "salesQty", label: "Продаж, шт", fmt: (r) => formatNumber(r.salesQty) },
  { key: "salesRub", label: "Продаж, руб", fmt: (r) => money(r.salesRub) },
  { key: "returnsQty", label: "Возврат, шт", fmt: (r) => formatNumber(r.returnsQty) },
  { key: "returnsRub", label: "Возврат, руб", fmt: (r) => money(r.returnsRub) },
  { key: "netQty", label: "Итого продаж, шт", fmt: (r) => formatNumber(r.netQty) },
  { key: "netRub", label: "Итого продаж, руб", fmt: (r) => money(r.netRub) },
  { key: "acquiring", label: "Эквайринг", fmt: (r) => money(r.acquiring) },
  { key: "commission", label: "Комиссия", fmt: (r) => money(r.commission) },
  { key: "assembly", label: "Сборка заказа", fmt: (r) => money(r.assembly) },
  { key: "dropOff", label: "Обработка отправления (Drop-off/Pick-up)", fmt: (r) => money(r.dropOff) },
  { key: "trunk", label: "Магистраль", fmt: (r) => money(r.trunk) },
  { key: "lastMile", label: "Последняя миля", fmt: (r) => money(r.lastMile) },
  { key: "reverseTrunk", label: "Обратная магистраль", fmt: (r) => money(r.reverseTrunk) },
  { key: "returnProcessing", label: "Обработка возврата", fmt: (r) => money(r.returnProcessing) },
  { key: "cancelProcessing", label: "Обработка отмененного или невостребованного товара", fmt: (r) => money(r.cancelProcessing) },
  { key: "unredeemedProcessing", label: "Обработка невыкупленного товара", fmt: (r) => money(r.unredeemedProcessing) },
  { key: "logistics", label: "Логистика", fmt: (r) => money(r.logistics) },
  { key: "reverseLogistics", label: "Обратная логистика", fmt: (r) => money(r.reverseLogistics) },
  { key: "logisticsTotal", label: "Итого логистика", fmt: (r) => money(r.logisticsTotal) },
  { key: "newTypes", label: "Прочие (новые типы)", fmt: (r) => money(r.newTypes) },
  { key: "cost", label: "Себестоимость", fmt: (r) => (r.cost == null ? "—" : money(r.cost)) },
  { key: "warehouse", label: "Склад", fmt: (r) => money(r.warehouse) },
  { key: "profitAfterTax", label: "ЧП с налогом", fmt: (r) => money(r.profitAfterTax) },
  { key: "profitBeforeTax", label: "ЧП без налога", fmt: (r) => money(r.profitBeforeTax) },
  { key: "marginAfterTaxPct", label: "Маржа с налогом", fmt: (r) => pct(r.marginAfterTaxPct) },
  { key: "marginBeforeTaxPct", label: "Маржа без налога", fmt: (r) => pct(r.marginBeforeTaxPct) },
];

export function OzonMarginByArticlePage() {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [cabinetId, setCabinetId] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<MarginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cabinets")
      .then((res) => res.json())
      .then((json: { cabinets?: Cabinet[] }) => setCabinets((json.cabinets ?? []).filter((c) => c.marketplace === "ozon")))
      .catch(() => setCabinets([]));
  }, []);

  useEffect(() => {
    if (!from || !to || from > to) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (cabinetId) params.append("cabinetId", cabinetId);
    fetch(`/api/opiu/ozon/margin?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as MarginResponse;
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(setData)
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setData(null);
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, from, to]);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sigma className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Маржа по артикулам (артикул Ozon)</h1>
            <p className="text-xs text-gray-500">По факту финотчёта Ozon, сгруппировано по Ozon SKU id</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={cabinetId}
              onChange={(e) => setCabinetId(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">Все кабинеты</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
            {data.missingCost.length > 0 && (
              <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">Нет себестоимости ({data.missingCost.length})</div>
                  <div className="text-xs">
                    Для артикулов: {data.missingCost.join(", ")}. В таблице у них стоит прочерк, а в прибыли и марже
                    себестоимость учтена как 0 — маржа по ним завышена. Заполните себестоимость в разделе «Себестоимость»
                    (источник «Ozon»).
                  </div>
                </div>
              </div>
            )}
            {data.check.newCharges.length > 0 && (
              <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">Новые расходы и начисления Ozon ({data.check.newCharges.length})</div>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {data.check.newCharges.map((c) => (
                      <li key={`${c.section}-${c.typeId}`}>
                        {c.label} (тип {c.typeId}, раздел «{SECTION_LABELS[c.section]}») — {money(c.amount)} за период
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 text-xs">
                    Этих начислений не было в таблице. Они вынесены в колонку «Прочие (новые типы)» и вычтены из прибыли,
                    поэтому маржа не завышена. Скажите, в какую постоянную колонку их относить — добавим.
                  </div>
                </div>
              </div>
            )}
            {data.meta.catalogIncomplete && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Каталог Ozon загрузился не полностью — часть артикулов может быть показана по SKU id и без себестоимости.
              </div>
            )}
            {!data.check.ok && (
              <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">Проверка: данные не сошлись с «Финансовым отчётом Ozon»</div>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {data.check.cells.filter((c) => !c.ok).map((c) => (
                      <li key={c.key}>{c.explanation}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <p className="mb-3 text-xs text-gray-400">
              Строк начислений: {data.meta.accrualRows} · артикулов с движением: {data.meta.skuCount}
              {" · "}Налог — 7,5% × 32% от «Итого продаж, руб» (как в таблице) · Себестоимость и склад — за единицу из базы
              себестоимостей × (продажи − возвраты, шт) · Маржа = ЧП / «Итого продаж, руб»; в «Итого» — сумма прибыли
              к сумме выручки
            </p>
            <div className="max-h-[75vh] overflow-auto rounded-2xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="sticky left-0 top-0 z-30 bg-white px-3 py-2 font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Артикул</th>
                    {COLUMNS.map((col) => (
                      <th key={col.key} className="sticky top-0 z-20 bg-white px-3 py-2 text-right font-semibold whitespace-nowrap shadow-[0_2px_4px_-2px_rgba(0,0,0,0.08)]">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 bg-violet-50 font-semibold">
                    <td className="sticky left-0 z-10 bg-violet-50 px-3 py-2">Итого</td>
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{col.fmt(data.totals)}</td>
                    ))}
                  </tr>
                  {data.rows.map((row) => (
                    <tr key={row.sku} className="group border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-gray-50">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold">{row.article}</div>
                          <div className="truncate text-[10px] text-gray-400">Ozon SKU id {row.sku}</div>
                        </div>
                      </td>
                      {COLUMNS.map((col) => (
                        <td
                          key={col.key}
                          className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${col.key === "cost" && row.cost == null ? "text-amber-600" : ""}`}
                        >
                          {col.fmt(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-gray-200 bg-gray-50 text-xs">
                    <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-semibold">Проверка</td>
                    {COLUMNS.map((col) => {
                      const c = data.check.cells.find((x) => x.key === col.key);
                      return (
                        <td
                          key={col.key}
                          title={c ? `В марже ${money(c.margin)}, в финотчёте ${money(c.report)}` : undefined}
                          className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${c ? (c.ok ? "text-emerald-600" : "font-semibold text-red-600") : "text-gray-300"}`}
                        >
                          {c ? (c.ok ? "0" : money(c.diff)) : "—"}
                        </td>
                      );
                    })}
                  </tr>
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
