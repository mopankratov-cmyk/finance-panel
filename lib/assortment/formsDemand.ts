import { MIN_SOURCE_MODELS, type FormsReport } from "./forms";
import type { FormDemandReport } from "./wbQueries";

/**
 * Две доли по каждой форме рядом: сколько моделей этой формы в каталогах брендов
 * и сколько поисков на WB приходится на неё. Обе — среди форм, названных
 * конкретно (без «куртка» и «сумка» вообще): общее слово занимает половину
 * поисков и половину каталога и ничего не сравнивает.
 *
 * Доля каталогов — средняя по источникам, как в таблице форм выше: каждый
 * источник с достаточным каталогом весит одинаково. Сырая доля моделей даёт
 * большому каталогу (Zara — сотни моделей) решать, «много» ли формы в каталогах.
 * Если ни один источник не набирает минимума, остаётся сырая доля — с пометкой.
 *
 * Это расчёт двух долей, а не прогноз: «ищут много, в каталогах мало» — повод
 * присмотреться к форме, а не вывод, что она «выстрелит». Каталоги — витрины
 * брендов (в основном зарубежных), спрос — российский поиск WB.
 */
export interface SupplyDemandRow {
  key: string;
  label: string;
  models: number;
  /** Доля формы среди названных в каталогах, % — средняя по источникам (или сырая, см. basis). */
  supplyShare: number | null;
  /** Почти вся форма у одного источника — «в каталогах много» тогда про ассортимент бренда. */
  concentrated: boolean;
  searches: number;
  demandShare: number | null;
  /** Доля поисков минус доля моделей, п.п.; null, если какой-то из долей нет. */
  gap: number | null;
  growthPct: number | null;
  topQueries: Array<{ word: string; searches: number }>;
}

export interface SupplyDemand {
  rows: SupplyDemandRow[];
  /** normalized — средняя по источникам; raw — ни у одного источника нет достаточного каталога. */
  basis: "normalized" | "raw";
  sourcesInAverage: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function compareSupplyDemand(report: FormsReport, demand: FormDemandReport): SupplyDemand {
  const supply = new Map(report.rows.filter((r) => !r.generic).map((r) => [r.key, r]));
  const wanted = new Map(demand.rows.filter((r) => !r.generic).map((r) => [r.key, r]));
  // Источники, у которых каталог достаточен и есть хоть одна модель с названной формой.
  const averaged = report.perSource.filter((s) => s.models >= MIN_SOURCE_MODELS && s.specific > 0);
  const basis: SupplyDemand["basis"] = averaged.length > 0 ? "normalized" : "raw";

  const supplyShareOf = (key: string): number | null => {
    const row = supply.get(key);
    if (!row) return averaged.length > 0 ? 0 : null;
    if (averaged.length === 0) return report.specific > 0 ? round((row.models / report.specific) * 100) : null;
    const counts = new Map(row.perSource.map((s) => [s.sourceId, s.count]));
    return round((averaged.reduce((sum, s) => sum + (counts.get(s.sourceId) ?? 0) / s.specific, 0) / averaged.length) * 100);
  };

  const keys = new Set([...supply.keys(), ...wanted.keys()]);
  const rows: SupplyDemandRow[] = [...keys].map((key) => {
    const s = supply.get(key);
    const d = wanted.get(key);
    const supplyShare = supplyShareOf(key);
    const demandShare = d?.shareOfNamed ?? (demand.named > 0 ? 0 : null);
    return {
      key,
      label: s?.label ?? d?.label ?? key,
      models: s?.models ?? 0,
      supplyShare,
      concentrated: Boolean(s?.concentrated),
      searches: d?.searches ?? 0,
      demandShare,
      gap: supplyShare != null && demandShare != null ? round(demandShare - supplyShare) : null,
      growthPct: d?.growthPct ?? null,
      topQueries: d?.top ?? [],
    };
  });
  rows.sort((a, b) => b.searches - a.searches || b.models - a.models || a.key.localeCompare(b.key));
  return { rows, basis, sourcesInAverage: averaged.length };
}
