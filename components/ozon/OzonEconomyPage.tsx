"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CabinetUnitSettings, type AppliedUnitSettings } from "@/components/unit/CabinetUnitSettings";
import { sumOzonEconomyRows } from "@/lib/ozon/economyTotals";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { OzonModuleHeader } from "./OzonModuleHeader";
import {
  EmptyState,
  Freshness,
  MetricCard,
  OzonCsvButton,
  OzonError,
  OzonLoading, OzonStaleNotice,
  OzonAdCoverageNotice, type OzonAdCoverageItem, OzonWarnings,
  ProductCell,
  StatusPill,
  formatMoney,
  formatNumber,
  formatPercent,
} from "./OzonUi";
import { useOzonCabinet } from "./OzonCabinetContext";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonUrlFilter } from "./useOzonUrlFilter";
import { useOzonPeriod } from "./useOzonPeriod";

interface EconomyRow {
  key: string;
  cabinet: string;
  offerId: string;
  name: string;
  image: string | null;
  units: number;
  revenue: number;
  price: number;
  /** Сколько заплатил покупатель после скидки Ozon — база налога. null — фактов нет. */
  buyerPrice: number | null;
  ozonDiscountPct: number | null;
  cost: number;
  commissionPct: number;
  commission: number;
  logistics: number;
  acquiring: number;
  extraCommission: number | null;
  ad: number;
  drr: number;
  taxPct: number;
  tax: number;
  profit: number | null;
  margin: number | null;
  reliability: "estimated" | "missing_cost";
  /** Схема, по тарифам которой посчитан товар. */
  scheme?: string;
  /** Продан, но в прайсе кабинета его нет — тарифов и прибыли не будет. */
  outOfCatalog?: boolean;
}

interface EconomyData {
  generatedAt: string;
  scope: { label: string; count: number };
  period: { days: number; from: string; to: string };
  taxPct: number;
  settings: (AppliedUnitSettings & { cabinetId: string }) | null;
  summary: {
    payout: number;
    deductions: number;
    refunds: number;
    calculatedProfit: number;
    missingCost: number;
    knownCostSku: number;
    knownCostRevenue: number;
    revenueCoveragePct: number;
    sku: number;
    /** Расход кабинета целиком — то же число, что на «Обзоре». */
    adSpend: number;
    /** Из него разнесено по проданным товарам. */
    adAllocated: number;
    adUnallocated: number;
  };
  services: { name: string; value: number }[];
  rows: EconomyRow[];
  adCoverage?: OzonAdCoverageItem[]; warnings: string[];
  note: string;
}

const money = (value: number | null) => (value == null ? "—" : formatMoney(value));

type SortKey =
  | "name" | "units" | "price" | "buyerPrice" | "ozonDiscountPct" | "cost" | "commission"
  | "logistics" | "acquiring" | "extraCommission" | "ad" | "tax" | "profit" | "margin";

function sortValue(row: EconomyRow, key: SortKey): number | string | null {
  if (key === "name") return `${row.name} ${row.offerId}`;
  const value = row[key];
  return value == null ? null : Number(value);
}

/** Колонки таблицы: заголовок, ключ сортировки и выравнивание — одним списком,
 *  чтобы шапка и порядок ячеек не разъезжались при правках. */
const COLUMNS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: "name", label: "Товар" },
  { key: "units", label: "Продано" },
  { key: "price", label: "Цена продавца" },
  { key: "buyerPrice", label: "Платит покупатель" },
  { key: "ozonDiscountPct", label: "Скидка Ozon" },
  { key: "cost", label: "Себес" },
  { key: "commission", label: "Комиссия" },
  { key: "logistics", label: "Логистика" },
  { key: "acquiring", label: "Эквайринг" },
  { key: "extraCommission", label: "Комиссия кабинета" },
  { key: "ad", label: "Реклама/шт.", hint: "Расход Performance за период, делённый на проданные единицы этого товара" },
  { key: "tax", label: "Налог" },
  { key: "profit", label: "Прибыль/шт." },
  { key: "margin", label: "Маржа" },
];

export function OzonEconomyPage() {
  const { activeCabinet, cabinetId, canWrite, noCabinets } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [query, setQuery] = useOzonUrlFilter<string>("q", "");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [onlySold, setOnlySold] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<EconomyData>("economy", period);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    const filtered = (data?.rows ?? []).filter((row) => {
      const problem = row.reliability === "missing_cost" || Number(row.margin) < 0;
      if (onlyProblem && !problem) return false;
      // За период продан не весь каталог: непроданные товары показывают
      // «прибыль» по каталожной цене и мешают искать реальные проблемы.
      if (onlySold && !(row.units > 0)) return false;
      if (!needle) return true;
      return `${row.name} ${row.offerId} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
    if (!sort) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const a = sortValue(left, sort.key);
      const b = sortValue(right, sort.key);
      if (typeof a === "string" || typeof b === "string") {
        return String(a).localeCompare(String(b), "ru-RU") * factor;
      }
      // Неизвестное значение всегда внизу, в какую бы сторону ни сортировали:
      // «нет себеса» — это не «маржа минус бесконечность».
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * factor;
    });
  }, [data?.rows, onlyProblem, onlySold, query, sort]);

  const totals = useMemo(() => sumOzonEconomyRows(rows), [rows]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-эконом", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Товар", value: (row: EconomyRow) => row.name },
        { header: "Артикул", value: (row: EconomyRow) => row.offerId },
        { header: "Кабинет", value: (row: EconomyRow) => row.cabinet },
        { header: "Продано, шт", value: (row: EconomyRow) => row.units },
        { header: "Выручка, ₽", value: (row: EconomyRow) => row.revenue },
        { header: "Цена продавца, ₽", value: (row: EconomyRow) => row.price },
        { header: "Платит покупатель, ₽", value: (row: EconomyRow) => row.buyerPrice },
        { header: "Скидка Ozon, %", value: (row: EconomyRow) => row.ozonDiscountPct },
        { header: "Себестоимость, ₽", value: (row: EconomyRow) => row.cost },
        { header: "Комиссия, ₽", value: (row: EconomyRow) => row.commission },
        { header: "Логистика, ₽", value: (row: EconomyRow) => row.logistics },
        { header: "Эквайринг, ₽", value: (row: EconomyRow) => row.acquiring },
        { header: "Реклама на шт, ₽", value: (row: EconomyRow) => row.ad },
        { header: "Налог, ₽", value: (row: EconomyRow) => row.tax },
        { header: "Прибыль на шт, ₽", value: (row: EconomyRow) => row.profit },
        { header: "Маржа, %", value: (row: EconomyRow) => row.margin },
        { header: "Данные", value: (row: EconomyRow) => row.reliability === "missing_cost" ? "нет себестоимости" : "расчёт" },
      ],
      rows,
    );
  };


  // Скидку Ozon видно не по всем товарам: отчёт о реализации закрывается по итогам
  // месяца. Показываем покрытие, чтобы «налог с цены продавца» не выглядел ошибкой.
  const discountCoverage = useMemo(() => {
    const all = data?.rows ?? [];
    return { known: all.filter((row) => row.ozonDiscountPct != null).length, total: all.length };
  }, [data?.rows]);

  return (
    <div>
      <OzonModuleHeader
        eyebrow="Ozon · Экономика"
        title="Юнит-экономика"
        subtitle="Цена покупателя, себестоимость, комиссии, логистика, реклама и налог — по каждому товару."
        period={period}
        preset={preset}
        onApplyPreset={applyPreset}
        onApplyRange={applyRange}
        onRefresh={refresh}
        refreshing={loading}
      />

      <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
        <CabinetUnitSettings
          cabinetId={cabinetId || null}
          cabinetName={activeCabinet?.name}
          canWrite={canWrite}
          applied={data?.settings ?? null}
          onSaved={refresh}
          tone="sky"
        />

        {loading && !data ? (
          <OzonLoading rows={9} />
        ) : noCabinets ? (
          <EmptyState title="Кабинет Ozon не подключён" detail="Добавьте кабинет с ключами Seller API и Performance API — после этого экраны наполнятся данными." href="/cabinets" />
        ) : error && !data ? (
          <OzonError message={error} onRetry={reload} />
        ) : !data ? (
          <EmptyState title="Нет данных экономики" detail="Проверьте цены, аналитику и себестоимость товаров." />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-600">
                {data.scope.label} · {data.period.from} — {data.period.to}
              </div>
              <Freshness generatedAt={data.generatedAt} />
            </div>
            {error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} /><OzonAdCoverageNotice coverage={data.adCoverage} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <MetricCard
                label="Расчётная прибыль"
                value={formatMoney(data.summary.calculatedProfit)}
                detail="только SKU с себестоимостью"
                tone={data.summary.calculatedProfit < 0 ? "red" : "emerald"}
              />
              <MetricCard label="К выплате" value={formatMoney(data.summary.payout)} detail="факт транзакций" />
              <MetricCard
                label="Реклама"
                value={formatMoney(data.summary.adSpend)}
                detail={data.summary.adSpend > 0
                  ? data.summary.adUnallocated > 0
                    ? `${formatMoney(data.summary.adUnallocated)} не разнесено по товарам`
                    : "разнесена по товарам полностью"
                  : "расход за период"}
                tone={data.summary.adUnallocated > 0 ? "amber" : "sky"}
              />
              <MetricCard label="Удержания" value={formatMoney(data.summary.deductions)} tone="amber" />
              <MetricCard label="Возвраты" value={formatMoney(data.summary.refunds)} tone="amber" />
              <MetricCard
                label="Без себестоимости"
                value={formatNumber(data.summary.missingCost)}
                tone={data.summary.missingCost ? "red" : "emerald"}
              />
              <MetricCard
                label="Скидка Ozon известна"
                value={`${formatNumber(discountCoverage.known)} / ${formatNumber(discountCoverage.total)}`}
                detail="база налога по отчёту реализации"
                tone={discountCoverage.known < discountCoverage.total ? "amber" : "emerald"}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.5fr)]">
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-2 border-b border-slate-100 p-3 lg:flex-row lg:items-center">
                  <label className="relative flex-1 lg:max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      type="search" enterKeyHint="search" placeholder="Поиск товара, артикула, кабинета"
                      className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8"
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600 sm:min-h-8">
                    <input
                      type="checkbox"
                      checked={onlyProblem}
                      onChange={(event) => setOnlyProblem(event.target.checked)}
                      className="h-4 w-4 accent-sky-700"
                    />
                    Только проблемные
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600 sm:min-h-8">
                    <input
                      type="checkbox"
                      checked={onlySold}
                      onChange={(event) => setOnlySold(event.target.checked)}
                      className="h-4 w-4 accent-sky-700"
                    />
                    Только с продажами
                  </label>
                  <div className="lg:ml-auto"><OzonCsvButton count={rows.length} onExport={() => exportCsv()} /></div>
                  <span className="text-[10px] text-slate-400">
                    {rows.length === data.rows.length ? `${formatNumber(rows.length)} SKU` : `${formatNumber(rows.length)} из ${formatNumber(data.rows.length)} SKU`}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="Товары не найдены" detail="Измените поиск или фильтр проблемных SKU." />
                  </div>
                ) : (
                  // Вертикальная прокрутка живёт здесь же — иначе sticky-шапка
                  // прилипает к контейнеру, который никуда не едет, и при
                  // длинной таблице заголовки колонок просто уезжают вверх.
                  // svh, а не vh: в мобильном браузере 100vh считается по
                  // свёрнутой адресной строке, и закреплённый итог оказывался
                  // ниже видимой области. overscroll-contain не даёт жесту,
                  // дошедшему до края таблицы, утянуть за собой страницу.
                  <div className="max-h-[68svh] overflow-auto overscroll-contain">
                    <table className="w-full min-w-[1480px] text-xs">
                      <thead className="sticky top-0 z-30 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          {COLUMNS.map((column, index) => {
                            const active = sort?.key === column.key;
                            return (
                              <th
                                key={column.key}
                                className={`${index === 0 ? "sticky left-0 z-20 bg-slate-50 px-4 text-left" : "px-3 text-right"} py-3 md:py-2`}
                                aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                              >
                                <button
                                  type="button"
                                  title={column.hint}
                                  aria-label={column.hint ? `${column.label}. ${column.hint}` : undefined}
                                  onClick={() => setSort((current) => current?.key === column.key
                                    ? (current.dir === "desc" ? { key: column.key, dir: "asc" } : null)
                                    : { key: column.key, dir: "desc" })}
                                  className={`tap-hit inline-flex items-center gap-1 uppercase tracking-wide hover:text-sky-700 ${active ? "font-bold text-sky-700" : ""} ${index === 0 ? "" : "flex-row-reverse"}`}
                                >
                                  {active ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-slate-300" />}
                                  {column.label}
                                </button>
                              </th>
                            );
                          })}
                          <th className="px-4 py-2 text-right">Данные</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.key}
                            className={`group border-t border-slate-100 hover:bg-sky-50/40 ${row.profit !== null && row.profit < 0 ? "bg-red-50/30" : ""}`}
                          >
                            {/* Колонка товара закреплена: 1480px без неё означают,
                                что после первой же прокрутки вбок цифры прибыли
                                не с чем соотнести. Фон обязан быть непрозрачным —
                                сквозь полупрозрачный читались бы проезжающие
                                колонки, — поэтому здесь стоят не сами bg-red-50/30
                                и bg-sky-50/40 строки, а их точные непрозрачные
                                эквиваленты поверх белого. */}
                            <td className={`sticky left-0 z-10 px-4 py-2 group-hover:bg-[#f9fdff] ${row.profit !== null && row.profit < 0 ? "bg-[#fffbfb]" : "bg-white"}`}>
                              <ProductCell
                                image={row.image}
                                name={row.name}
                                code={row.offerId}
                                cabinet={data.scope.count > 1 ? row.cabinet : undefined}
                              />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.units)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.price)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-sky-700">{money(row.buyerPrice)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                              {row.ozonDiscountPct == null ? "—" : formatPercent(row.ozonDiscountPct)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.cost ? formatMoney(row.cost) : "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.outOfCatalog ? "—" : <>{formatMoney(row.commission)} <span className="text-[9px] text-slate-400">({formatPercent(row.commissionPct)}{row.scheme && row.scheme !== "—" ? ` · ${row.scheme}` : ""})</span></>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.logistics)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.acquiring)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{money(row.extraCommission)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.ad)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(row.tax)} <span className="text-[9px] text-slate-400">({formatPercent(row.taxPct)})</span>
                            </td>
                            <td className={`px-3 py-2 text-right font-bold tabular-nums ${row.profit === null ? "text-slate-400" : row.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                              {row.profit === null ? "—" : formatMoney(row.profit)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.margin === null ? "text-slate-400" : row.margin < 0 ? "text-red-600" : ""}`}>
                              {row.margin === null ? "—" : formatPercent(row.margin)}
                            </td>
                            <td className="px-4 py-2 text-right"><StatusPill status={row.reliability} /></td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Итог — по обороту, а не по колонкам «на штуку»: расход
                          и прибыль умножены на проданные единицы. Прибыль и
                          маржа считаются только по строкам с себестоимостью. */}
                      <tfoot className="sticky bottom-0 z-20 border-t-2 border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700">
                        <tr>
                          <td className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5">
                            Итого · {formatNumber(totals.rows)} SKU
                            <span className="ml-2 font-normal text-slate-400">
                              выручка {formatMoney(totals.revenue)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(totals.units)}</td>
                          <td colSpan={8} />
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(totals.ad)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(totals.tax)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${totals.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatMoney(totals.profit)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{totals.margin == null ? "—" : formatPercent(totals.margin)}</td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {/* Фраза относится ко всей таблице, а не к колонкам 3–10: внутри
                    итоговой строки она уезжала вместе с прокруткой вбок и
                    всплывала посреди чужих цифр. При пустой выборке молчит —
                    иначе рядом с «Товары не найдены» она отчитывалась о
                    себестоимости строк, которых на экране нет. */}
                {rows.length > 0 ? (
                  <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400 md:text-[10px]">
                    {totals.revenueCoverage == null
                      ? "Себестоимость не известна ни по одной строке"
                      : `Себестоимость известна по ${formatPercent(totals.revenueCoverage)} оборота`}
                  </p>
                ) : null}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-bold text-slate-900">Фактические услуги Ozon</h2>
                <p className="mt-1 text-[10px] text-slate-400">
                  Структура удержаний по транзакциям; не распределяется искусственно по SKU.
                </p>
                <div className="mt-4 space-y-3">
                  {data.services.length ? (
                    data.services.map((service) => {
                      const max = data.services[0]?.value || 1;
                      return (
                        <div key={service.name}>
                          <div className="mb-1 flex justify-between gap-3 text-[11px]">
                            <span className="truncate text-slate-600" title={service.name}>{service.name}</span>
                            <span className="shrink-0 font-semibold tabular-nums">{formatMoney(service.value)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.max(2, service.value / max * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-xs text-slate-400">Нет детализации услуг за период.</div>
                  )}
                </div>
              </section>
            </div>

            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 md:text-[10px]">
              {data.note} Налог берётся с цены покупателя: Ozon добивает часть цены за него, и с этой доли налога нет.
              Скидка известна по {formatNumber(discountCoverage.known)} из {formatNumber(discountCoverage.total)} SKU — по остальным базой остаётся цена продавца.
              Статус «Расчёт» означает оценку, а не бухгалтерский факт.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
