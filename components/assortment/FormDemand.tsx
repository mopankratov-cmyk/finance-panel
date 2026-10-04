"use client";

import type { FormsReport } from "@/lib/assortment/forms";
import { compareSupplyDemand } from "@/lib/assortment/formsDemand";
import type { FormDemandReport } from "@/lib/assortment/wbQueries";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`;

/**
 * Спрос на WB по формам рядом с каталогами брендов. Две доли среди форм, названных
 * конкретно; это расчёт, а не прогноз продаж. Частотность — оценка MPSTATS на дату,
 * не сумма за период.
 */
export function FormDemand({ report, demand }: { report: FormsReport; demand: FormDemandReport | null }) {
  if (!demand) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
        Спрос на WB по формам пока недоступен: срезы частотности запросов ещё не собраны (сборщик снимает их раз в неделю после выкладки и применения миграции 202610050003) или не прочитались.
      </p>
    );
  }
  const { rows: all, basis } = compareSupplyDemand(report, demand);
  const rows = all.filter((r) => r.searches > 0 || r.models > 0);
  const generic = demand.rows.filter((r) => r.generic).reduce((sum, r) => sum + r.searches, 0);
  const share = (n: number) => (demand.searches > 0 ? pct(Math.round((n / demand.searches) * 1000) / 10) : "—");
  const excludedTotal = demand.searches + demand.excluded.searches;
  const excludedShare = excludedTotal > 0 ? pct(Math.round((demand.excluded.searches / excludedTotal) * 1000) / 10) : "0%";
  const partial = demand.subjects.length < demand.subjectsTotal;

  return (
    <section aria-label="Спрос на WB" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Что ищут на WB — и что в каталогах брендов</h2>
        <span className="text-xs text-slate-500">частотность на {dm(demand.windowTo)} · {num(demand.queries)} запросов · предметы: {demand.subjects.join(", ")}</span>
      </div>
      {(partial || demand.laggingSubjects.length > 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Срез снят по {demand.subjects.length} из {demand.subjectsTotal} предметов
          {demand.laggingSubjects.length > 0 ? `; по предметам ${demand.laggingSubjects.join(", ")} свежего среза нет, они в расчёт не вошли` : ""}.
          Доли форм посчитаны по тому, что есть, — часть спроса может быть не видна.
        </p>
      )}
      <div className="hidden grid-cols-[minmax(0,1.5fr)_96px_110px_96px_96px] gap-3 px-3 text-xs text-slate-500 md:grid">
        <span>Форма</span>
        <span className="text-right">Доля поисков</span>
        <span className="text-right" title={basis === "normalized" ? "Средняя по источникам: каждый источник с достаточным каталогом весит одинаково" : "Сырая доля моделей: источников с достаточным каталогом нет"}>
          Доля моделей в каталогах{basis === "normalized" ? " (средняя по источникам)" : ""}
        </span>
        <span className="text-right" title="Доля поисков минус доля моделей, процентных пунктов">Разница, п.п.</span>
        <span className="text-right" title={demand.previousTo ? `К срезу на ${dm(demand.previousTo)}` : "Прошлого среза ещё нет"}>Рост поисков</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,1.5fr)_96px_110px_96px_96px] md:items-center md:gap-3">
            <span className="break-anywhere text-sm font-medium text-slate-900">{row.label}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 md:contents">
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Поиски </span>{row.searches === 0 ? <span className="text-slate-500" title="Среди самых частых запросов предметов такой формы нет">не в топе</span> : row.demandShare == null ? "—" : pct(row.demandShare)}</span>
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Каталоги </span>{row.supplyShare == null ? "—" : pct(row.supplyShare)}</span>
              <span className={`md:text-right ${row.gap != null && row.gap >= 5 && !row.concentrated ? "font-medium text-violet-700" : ""}`}><span className="text-xs text-slate-500 md:hidden">Разница, п.п. </span>{row.gap == null ? "—" : signed(row.gap)}</span>
              <span className={`md:text-right ${row.growthPct != null && row.growthPct < 0 ? "text-red-700" : row.growthPct != null && row.growthPct > 0 ? "text-green-700" : ""}`}><span className="text-xs text-slate-500 md:hidden">Рост </span>{row.growthPct == null ? "—" : `${signed(row.growthPct)}%`}</span>
            </span>
          </div>
          {row.topQueries.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {row.topQueries.map((q) => `${q.word} — ${num(q.searches)}`).join(" · ")}
            </p>
          )}
          {row.concentrated && <p className="mt-1 text-xs leading-5 text-amber-800">В каталогах почти всё у одного источника — это ассортимент бренда, разницу с поиском читать осторожно.</p>}
        </div>
      ))}
      <p className="text-xs leading-5 text-slate-500">
        Разница — доля поисков минус доля моделей в каталогах, в процентных пунктах. Обе доли считаются среди форм, названных конкретно: общие «{report.direction === "bags" ? "сумка" : "куртка"}» ({share(generic)} поисков) и запросы без формы ({share(demand.unnamed.searches)}) в сравнение не входят.
        Каталоги и профили женские, поэтому из поиска убраны мужские, детские и не по теме запросы ({excludedShare} частотности); запрос без указания пола остаётся.
        Это сравнение двух долей, а не прогноз: «ищут много, в каталогах мало» — повод присмотреться, а не вывод. Каталоги — витрины брендов, в основном зарубежных; поиск — российский WB.
        Частотность — оценка MPSTATS на дату{demand.previousTo ? `, рост — к срезу на ${dm(demand.previousTo)} и только по запросам, которые есть в обоих срезах` : "; прошлого среза для роста пока нет"}.
        Спрос сезонный: осенью пуховик и парка растут сами по себе, поэтому форму лучше сравнивать с другими формами того же среза, чем читать рост за месяц как тенденцию. Цен и выручки здесь нет.
      </p>
    </section>
  );
}
