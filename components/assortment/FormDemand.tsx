"use client";

import { MIN_SOURCE_MODELS, type FormsReport } from "@/lib/assortment/forms";
import { compareSupplyDemand } from "@/lib/assortment/formsDemand";
import type { FormDemandReport } from "@/lib/assortment/wbQueries";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
/** С какой разницы долей (п.п.) строка получает пометку «повод посмотреть» — порог наш, не свойство данных. */
const LOOK_GAP = 5;
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
        <h2 className="text-sm font-semibold text-slate-900">
          Что ищут на WB — и что в каталогах брендов
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[11px] font-normal text-slate-600">расчёт по оценке MPSTATS</span>
        </h2>
        <span className="text-xs text-slate-500">частотность на {dm(demand.windowTo)} · {num(demand.queries)} запросов · предметы: {demand.subjects.join(", ")}</span>
      </div>
      {(partial || demand.laggingSubjects.length > 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Срез снят по {demand.subjects.length} из {demand.subjectsTotal} предметов
          {demand.laggingSubjects.length > 0 ? `; по предметам ${demand.laggingSubjects.join(", ")} свежего среза нет, они в расчёт не вошли` : ""}.
          Доли форм посчитаны по тому, что есть, — часть спроса может быть не видна.
        </p>
      )}
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
        Из всех поисков по предметам <b>{share(generic)}</b> — общее «{report.direction === "bags" ? "сумка" : "куртка"}», <b>{share(demand.unnamed.searches)}</b> — запросы без формы, <b>{share(demand.named)}</b> — запросы с названной формой.
        Доли в таблице — только среди названных форм: общее слово занимает большую часть поиска и ничего не сравнивает.
      </p>
      <div className="hidden grid-cols-[minmax(0,1.4fr)_104px_120px_88px_112px] gap-3 px-3 text-xs text-slate-500 md:grid">
        <span>Форма</span>
        <span className="text-right">Доля поисков среди названных форм</span>
        <span className="text-right">Доля моделей в каталогах{basis === "normalized" ? " (средняя по источникам)" : " (сырая)"}</span>
        <span className="text-right">Разница, п.п.</span>
        <span className="text-right">Рост поисков{demand.previousTo ? ` к ${dm(demand.previousTo)}` : ""}, возможно сезон</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,1.4fr)_104px_120px_88px_112px] md:items-center md:gap-3">
            <span className="break-anywhere text-sm font-medium text-slate-900">{row.label}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 md:contents">
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Поиски </span>{row.searches === 0 ? <span className="text-slate-500">не в топе</span> : row.demandShare == null ? "—" : pct(row.demandShare)}</span>
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Каталоги </span>{row.supplyShare == null ? "—" : pct(row.supplyShare)}</span>
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Разница, п.п. </span>{row.gap == null ? "—" : signed(row.gap)}</span>
              <span className="md:text-right"><span className="text-xs text-slate-500 md:hidden">Рост </span>{row.growthPct == null ? "—" : `${signed(row.growthPct)}%`}</span>
            </span>
          </div>
          {row.topQueries.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {row.topQueries.map((q) => `${q.word} — ${num(q.searches)}`).join(" · ")}
            </p>
          )}
          {row.gap != null && row.gap >= LOOK_GAP && !row.concentrated && <p className="mt-1 text-xs leading-5 text-slate-600">Поисков заметно больше, чем моделей (разница от {LOOK_GAP} п.п.) — повод посмотреть, а не вывод.</p>}
          {row.concentrated && <p className="mt-1 text-xs leading-5 text-amber-800">В каталогах почти всё у одного источника — это ассортимент бренда, разницу с поиском читать осторожно.</p>}
        </div>
      ))}
      <p className="text-xs leading-5 text-slate-500">
        Разница — доля поисков минус доля моделей в каталогах, в процентных пунктах; от {LOOK_GAP} п.п. строка помечена «повод посмотреть» (порог наш).
        {basis === "normalized"
          ? ` Доля моделей — средняя по источникам: каждый источник, где не меньше ${MIN_SOURCE_MODELS} моделей и не меньше ${MIN_SOURCE_MODELS} с названной формой, весит одинаково, большой каталог не делает форму «сильнее».`
          : ` Доля моделей — сырая: источников, где не меньше ${MIN_SOURCE_MODELS} моделей с названной формой, пока нет, поэтому её определяет самый большой каталог.`}
        {" "}«Не в топе» — среди самых частых запросов предметов такой формы нет.
        Каталоги и профили женские, поэтому из поиска убраны мужские, детские и не по теме запросы ({excludedShare} частотности); запрос без указания пола остаётся.
        Это сравнение двух долей, а не прогноз: «ищут много, в каталогах мало» — повод присмотреться, а не вывод. Каталоги — витрины брендов, в основном зарубежных; поиск — российский WB.
        Частотность — оценка MPSTATS на дату{demand.previousTo ? `, рост — к срезу на ${dm(demand.previousTo)} и только по запросам, которые есть в обоих срезах` : ""}.
        {demand.growthBase === "none" && " Прошлого среза для роста пока нет."}
        {demand.growthBase === "identical" && " Рост не считаем: у почти всех общих запросов частотность та же, что в прошлом срезе, — это не два разных периода."}
        {demand.growthBase === "ok" && " «—» в росте — у формы мало запросов в обоих срезах (меньше 1 000 частотности) или её не было в прошлом срезе."}
        {" "}Спрос сезонный: осенью пуховик и парка растут сами по себе, поэтому форму лучше сравнивать с другими формами того же среза, чем читать рост за месяц как тенденцию. Цен и выручки здесь нет.
      </p>
    </section>
  );
}
