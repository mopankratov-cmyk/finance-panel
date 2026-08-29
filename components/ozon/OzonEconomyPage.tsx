"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CabinetUnitSettings, type AppliedUnitSettings } from "@/components/unit/CabinetUnitSettings";
import { OzonModuleHeader } from "./OzonModuleHeader";
import {
  EmptyState,
  Freshness,
  MetricCard,
  OzonError,
  OzonLoading, OzonStaleNotice,
  OzonWarnings,
  ProductCell,
  StatusPill,
  formatMoney,
  formatNumber,
  formatPercent,
} from "./OzonUi";
import { useOzonCabinet } from "./OzonCabinetContext";
import { useOzonCockpit } from "./useOzonCockpit";
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
  };
  services: { name: string; value: number }[];
  rows: EconomyRow[];
  warnings: string[];
  note: string;
}

const money = (value: number | null) => (value == null ? "—" : formatMoney(value));

export function OzonEconomyPage() {
  const { activeCabinet, cabinetId, canWrite } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [query, setQuery] = useState("");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<EconomyData>("economy", period);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.rows ?? []).filter((row) => {
      const problem = row.reliability === "missing_cost" || Number(row.margin) < 0;
      if (onlyProblem && !problem) return false;
      if (!needle) return true;
      return `${row.name} ${row.offerId} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [data?.rows, onlyProblem, query]);

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
            {error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard
                label="Расчётная прибыль"
                value={formatMoney(data.summary.calculatedProfit)}
                detail="только SKU с себестоимостью"
                tone={data.summary.calculatedProfit < 0 ? "red" : "emerald"}
              />
              <MetricCard label="К выплате" value={formatMoney(data.summary.payout)} detail="факт транзакций" />
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
                      placeholder="Поиск товара, артикула, кабинета"
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
                  <span className="text-[10px] text-slate-400 lg:ml-auto">
                    {rows.length === data.rows.length ? `${formatNumber(rows.length)} SKU` : `${formatNumber(rows.length)} из ${formatNumber(data.rows.length)} SKU`}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="Товары не найдены" detail="Измените поиск или фильтр проблемных SKU." />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1480px] text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2 text-left">Товар</th>
                          <th className="px-3 py-2 text-right">Продано</th>
                          <th className="px-3 py-2 text-right">Цена продавца</th>
                          <th className="px-3 py-2 text-right">Платит покупатель</th>
                          <th className="px-3 py-2 text-right">Скидка Ozon</th>
                          <th className="px-3 py-2 text-right">Себес</th>
                          <th className="px-3 py-2 text-right">Комиссия</th>
                          <th className="px-3 py-2 text-right">Логистика</th>
                          <th className="px-3 py-2 text-right">Эквайринг</th>
                          <th className="px-3 py-2 text-right">Комиссия кабинета</th>
                          <th className="px-3 py-2 text-right">Реклама/шт.</th>
                          <th className="px-3 py-2 text-right">Налог</th>
                          <th className="px-3 py-2 text-right">Прибыль/шт.</th>
                          <th className="px-3 py-2 text-right">Маржа</th>
                          <th className="px-4 py-2 text-right">Данные</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.key}
                            className={`border-t border-slate-100 hover:bg-sky-50/40 ${row.profit !== null && row.profit < 0 ? "bg-red-50/30" : ""}`}
                          >
                            <td className="px-4 py-2">
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
                              {formatMoney(row.commission)} <span className="text-[9px] text-slate-400">({formatPercent(row.commissionPct)})</span>
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
                    </table>
                  </div>
                )}
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

            <p className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] text-slate-500">
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
