import { fitFor, type BrandProfile } from "./brandProfiles";
import type { FormsReport } from "./forms";
import { compareSupplyDemand } from "./formsDemand";
import type { FormDemandReport } from "./wbQueries";

/**
 * Числа рядом с решениями профиля: по каждой форме — доля поисков на WB и доля моделей в каталогах (те же, что на «Формах»),
 * чтобы владелец, решая «подходит / не подходит», видел, о чём речь. Это справка, а не вывод: «ищут много» не значит «подходит
 * бренду», а профиль решает владелец. Чистые функции.
 */

export interface FormNumbers {
  key: string;
  label: string;
  /** Моделей формы в каталогах. */
  models: number;
  /** Доля поисков среди названных форм, %; null — среза спроса нет. */
  demandShare: number | null;
  /** Доля моделей в каталогах среди названных форм, % (как на «Формах»); null — среза спроса нет. */
  supplyShare: number | null;
  /** Форма есть среди самых частых запросов предметов. */
  inDemandTop: boolean;
  /** Почти всё в каталогах у одного источника — это ассортимент бренда. */
  concentrated: boolean;
}

/** Числа по формам раздела. Без среза спроса — только число моделей (долей нет, чтобы не показывать одну из двух). */
export function formNumbers(report: FormsReport | null, demand: FormDemandReport | null): Map<string, FormNumbers> {
  const out = new Map<string, FormNumbers>();
  if (!report) return out;
  if (!demand) {
    for (const row of report.rows.filter((r) => !r.generic)) {
      out.set(row.key, { key: row.key, label: row.label, models: row.models, demandShare: null, supplyShare: null, inDemandTop: false, concentrated: row.concentrated });
    }
    return out;
  }
  for (const row of compareSupplyDemand(report, demand).rows) {
    out.set(row.key, { key: row.key, label: row.label, models: row.models, demandShare: row.demandShare, supplyShare: row.supplyShare, inDemandTop: row.searches > 0, concentrated: row.concentrated });
  }
  return out;
}

/** Сколько форм с самым большим спросом, по которым профиль ещё ничего не решил, называем сверху. */
export const UNDECIDED_TOP = 3;

/** Формы с самым большим спросом на WB, по которым профиль ничего не решил («не решено»): с чего начать заполнение. */
export function undecidedByDemand(profile: Pick<BrandProfile, "fitForms" | "avoidForms">, numbers: Map<string, FormNumbers>, limit = UNDECIDED_TOP): FormNumbers[] {
  return [...numbers.values()]
    .filter((n) => fitFor(profile, n.key) === null && n.demandShare !== null && n.demandShare > 0)
    .sort((a, b) => (b.demandShare ?? 0) - (a.demandShare ?? 0) || a.label.localeCompare(b.label, "ru"))
    .slice(0, limit);
}
