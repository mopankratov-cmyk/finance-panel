import type { MarketplaceMonthlyActual } from "./monthlyStatement";
import type { OpiuBrand } from "./constants";

export interface MonthlyMarketplaceSource extends MarketplaceMonthlyActual {
  id: string;
  label: string;
  /** Бизнес-бренд источника. У Ozon разреза по брендам пока нет. */
  brand?: string;
  marketplace: "wb" | "ozon";
  companyId?: string;
}

type WbActual = NonNullable<MarketplaceMonthlyActual["wb"]>;
type OzonActual = NonNullable<MarketplaceMonthlyActual["ozon"]>;

const sum = <T>(rows: readonly T[], pick: (row: T) => number) => Math.round(rows.reduce((total, row) => total + pick(row), 0));
const sumNullable = <T>(rows: readonly T[], pick: (row: T) => number | null) => {
  const values = rows.map(pick).filter((value): value is number => value != null);
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0)) : null;
};

/** Бизнес-владелец бренда важнее общей связи кабинета с юрлицами. */
export function wbBrandCompanyName(brand: Pick<OpiuBrand, "id" | "entity">): string {
  if (brand.id.startsWith("optima-")) return "Оптима";
  if (brand.id === "norvia" || brand.id === "heaton") return "ИП Филиппов";
  return brand.entity;
}

export function aggregateWbSources(sources: readonly MonthlyMarketplaceSource[]): WbActual {
  const ready = sources.flatMap((source) => source.wb && !source.wb.error ? [source.wb] : []);
  if (!ready.length) return { revenue_before_spp: 0, revenue_after_spp: 0, commission: 0, acquiring: 0, ad: 0, other: 0, cogs: 0, packaging: 0, logistics: null, storage: null, penalty: null, error: "Нет доступных источников WB" };
  const failed = sources.flatMap((source) => source.wb?.error ? [source.wb.error] : []);
  const partialReasons = [
    ...ready.flatMap((row) => row.partialReason ? [row.partialReason] : []),
    ...failed,
  ];
  return {
    revenue_before_spp: sum(ready, (row) => row.revenue_before_spp),
    revenue_after_spp: sum(ready, (row) => row.revenue_after_spp ?? row.revenue_before_spp),
    commission: sum(ready, (row) => row.commission),
    acquiring: sum(ready, (row) => row.acquiring),
    ad: sum(ready, (row) => row.ad),
    other: sum(ready, (row) => row.other),
    cogs: sum(ready, (row) => row.cogs),
    packaging: sum(ready, (row) => row.packaging),
    logistics: sumNullable(ready, (row) => row.logistics),
    storage: sumNullable(ready, (row) => row.storage),
    penalty: sumNullable(ready, (row) => row.penalty),
    partial: ready.some((row) => row.partial) || failed.length > 0,
    partialReason: [...new Set(partialReasons)].join("; ") || undefined,
    warnings: ready.flatMap((row) => row.warnings ?? []),
  };
}

/**
 * Один бренд может продаваться из нескольких WB-кабинетов (например,
 * Norvia/Heaton в Retail Family и Оптиме). В ОПиУ это одна колонка бренда,
 * поэтому одноимённые источники одной компании складываются, а сбой одного
 * кабинета остаётся видимым предупреждением у частичного результата.
 */
export function coalesceWbSources(sources: readonly MonthlyMarketplaceSource[]): MonthlyMarketplaceSource[] {
  const groups = new Map<string, MonthlyMarketplaceSource[]>();
  for (const source of sources) {
    const key = `${source.companyId ?? ""}\u0000${source.label}`;
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const wb = aggregateWbSources(group);
    const failed = group.flatMap((source) => source.wb?.error ? [source.wb.error] : []);
    if (!wb.error && failed.length) wb.warnings = [...(wb.warnings ?? []), ...failed];
    return {
      id: group.map((source) => source.id).join("+"),
      label: group[0]!.label,
      brand: group[0]!.brand,
      marketplace: "wb",
      companyId: group[0]!.companyId,
      wb,
    };
  });
}

export function monthlyBrandOptions(sources: readonly MonthlyMarketplaceSource[], companyId = ""): string[] {
  return [...new Set(sources
    .filter((source) => !companyId || source.companyId === companyId)
    .flatMap((source) => source.brand ? [source.brand] : []))]
    .sort((left, right) => left.localeCompare(right, "ru"));
}

export function filterMonthlySources(
  sources: readonly MonthlyMarketplaceSource[],
  filters: { companyId?: string; brand?: string },
): MonthlyMarketplaceSource[] {
  return sources.filter((source) => (
    (!filters.companyId || source.companyId === filters.companyId)
    && (!filters.brand || source.brand === filters.brand)
  ));
}

export function aggregateOzonSources(sources: readonly MonthlyMarketplaceSource[]): OzonActual {
  const ready = sources.flatMap((source) => source.ozon && !source.ozon.error && !source.ozon.noCabinet ? [source.ozon] : []);
  if (!ready.length) return { revenue: 0, commission: 0, delivery: 0, services: 0, cogs: 0, error: "Нет доступных источников Ozon", noCabinet: true };
  return {
    revenue: sum(ready, (row) => row.revenue),
    commission: sum(ready, (row) => row.commission),
    delivery: sum(ready, (row) => row.delivery),
    services: sum(ready, (row) => row.services),
    cogs: sum(ready, (row) => row.cogs),
    warnings: ready.flatMap((row) => row.warnings ?? []),
  };
}
