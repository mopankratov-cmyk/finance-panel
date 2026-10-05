"use client";

import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { demandTerm, type DemandResult } from "@/lib/assortment/wbDemand";

export type Demand = DemandResult & { period: { from: string; to: string }; subjectsChecked: string[]; previousTo: string | null; queriesChecked: number };
type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; demand: Demand };

const num = (n: number) => n.toLocaleString("ru-RU");
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * «Спрос на WB»: частотность запросов со словом модели в предметах-силуэтах
 * раздела — недельные срезы MPSTATS из базы. Без цен и выручки.
 */
export function WbDemand({ direction, attributes }: { direction: AssortmentDirection; attributes: Record<string, string | null> }) {
  const term = demandTerm(direction, attributes);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/wb-demand?direction=${direction}&term=${encodeURIComponent(term)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || body?.error) setState({ kind: "error", message: body?.error || `Спрос не загрузился (${response.status})` });
        else setState({ kind: "ready", demand: body.demand });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, [direction, term]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Спрос на WB</h2>
        <span className="text-xs text-slate-500">MPSTATS — оценка для направления, не абсолютные числа; срез раз в неделю. Цены и выручку не берём.</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
        {!term && (
          <p className="text-slate-600">
            Заполните в признаках «{direction === "bags" ? "Силуэт" : "Подтип"}» или «Запрос на WB» — например, «хобо» или «бомбер», — и здесь появится частотность таких запросов на WB.
          </p>
        )}
        {term && state.kind === "loading" && <p className="text-slate-500">Считаем спрос по запросу «{term}»…</p>}
        {term && state.kind === "error" && <p className="text-amber-800">{state.message}</p>}
        {term && state.kind === "ready" && <DemandBody term={term} demand={state.demand} />}
      </div>
    </section>
  );
}

/** Результат спроса по слову модели — отдельно от загрузки, чтобы его можно было показать на любых данных. */
export function DemandBody({ term, demand }: { term: string; demand: Demand }) {
  const excluded = demand.excluded?.searches > 0
    ? `Мужские, детские и не по теме запросы со словом «${term}» (${num(demand.excluded.queries)}, частотность ${num(demand.excluded.searches)}) в расчёт не вошли: каталоги и профили женские.`
    : null;
  if (!demand.found) {
    return (
      <div className="flex flex-col gap-1">
        {excluded ? (
          <p className="text-slate-600">Запросов со словом «{term}» для наших каталогов нет: {excluded.charAt(0).toLowerCase() + excluded.slice(1)}</p>
        ) : (
          <p className="text-slate-600">
            Запросов со словом «{term}» нет среди {num(demand.queriesChecked)} самых частых запросов предметов {demand.subjectsChecked.join(", ")}: спрос небольшой или на WB это называют иначе — уточните «Запрос на WB».
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-800">
        Запросы со словом «{term}»: частотность <b>{num(demand.total)}</b> на {dm(demand.period.to)}
        {demand.growthPct !== null && demand.previousTo && (
          <span className="text-slate-600"> ({demand.growthPct >= 0 ? "+" : ""}{demand.growthPct}% к срезу на {dm(demand.previousTo)}, возможно сезон)</span>
        )}
      </p>
      {demand.growthBase === "identical" && <p className="text-xs leading-5 text-slate-500">Рост не считаем: у почти всех запросов частотность та же, что в прошлом срезе, — это не два разных периода.</p>}
      {demand.growthBase === "none" && <p className="text-xs leading-5 text-slate-500">Прошлого среза для роста пока нет.</p>}
      {excluded && <p className="text-xs leading-5 text-slate-500">{excluded}</p>}
      {demand.subjects.map((s) => (
        <div key={s.subject} className="flex flex-col gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Предмет «{s.subject}»</div>
          <ul className="flex flex-col divide-y divide-slate-100">
            {s.queries.map((q) => (
              <li key={q.word} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="text-slate-800">{q.word}</span>
                <span className="text-xs text-slate-500">
                  {num(q.now)}
                  {q.before !== null ? ` · было ${num(q.before)}` : s.compared ? " · новый в топе" : ""}
                  {q.items !== null && ` · товаров ${num(q.items)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
