import type { FormsReport } from "./forms";
import type { FormDemandReport } from "./wbQueries";

/**
 * Две доли по каждой форме рядом: сколько моделей этой формы в каталогах брендов
 * и сколько поисков на WB приходится на неё. Обе — среди форм, названных
 * конкретно (без «куртка» и «сумка» вообще): общее слово занимает половину
 * поисков и половину каталога и ничего не сравнивает.
 *
 * Это расчёт двух долей, а не прогноз: «ищут много, в каталогах мало» — повод
 * присмотреться к форме, а не вывод, что она «выстрелит». Каталоги — витрины
 * брендов (в основном зарубежных), спрос — российский поиск WB.
 */
export interface SupplyDemandRow {
  key: string;
  label: string;
  models: number;
  supplyShare: number | null;
  searches: number;
  demandShare: number | null;
  /** Доля поисков минус доля моделей, п.п.; null, если какой-то из долей нет. */
  gap: number | null;
  growthPct: number | null;
  topQueries: Array<{ word: string; searches: number }>;
}

export function compareSupplyDemand(report: FormsReport, demand: FormDemandReport): SupplyDemandRow[] {
  const supply = new Map(report.rows.filter((r) => !r.generic).map((r) => [r.key, r]));
  const wanted = new Map(demand.rows.filter((r) => !r.generic).map((r) => [r.key, r]));
  const keys = new Set([...supply.keys(), ...wanted.keys()]);
  const round = (n: number) => Math.round(n * 10) / 10;
  const rows: SupplyDemandRow[] = [...keys].map((key) => {
    const s = supply.get(key);
    const d = wanted.get(key);
    const supplyShare = s && report.specific > 0 ? round((s.models / report.specific) * 100) : null;
    const demandShare = d?.shareOfNamed ?? null;
    return {
      key,
      label: s?.label ?? d?.label ?? key,
      models: s?.models ?? 0,
      supplyShare,
      searches: d?.searches ?? 0,
      demandShare,
      gap: supplyShare != null && demandShare != null ? round(demandShare - supplyShare) : null,
      growthPct: d?.growthPct ?? null,
      topQueries: d?.top ?? [],
    };
  });
  return rows.sort((a, b) => b.searches - a.searches || b.models - a.models || a.key.localeCompare(b.key));
}
