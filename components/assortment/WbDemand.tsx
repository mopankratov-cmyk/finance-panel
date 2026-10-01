"use client";

import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { demandTerm, type DemandResult } from "@/lib/assortment/wbDemand";

type Demand = DemandResult & { period: { from: string; to: string }; subjectsChecked: string[] };
type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; demand: Demand };

const num = (n: number) => n.toLocaleString("ru-RU");
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * «Спрос на WB»: частотность запросов со словом модели в предметах своих
 * товаров раздела, по MPSTATS. Без цен и выручки.
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
        <span className="text-xs text-slate-500">MPSTATS — оценка для направления, не абсолютные числа. Цены и выручку не берём.</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
        {!term && (
          <p className="text-slate-600">
            Заполните в признаках «{direction === "bags" ? "Силуэт" : "Подтип"}» или «Запрос на WB» — например, «хобо» или «бомбер», — и здесь появится частотность таких запросов на WB.
          </p>
        )}
        {term && state.kind === "loading" && <p className="text-slate-500">Считаем спрос по запросу «{term}»…</p>}
        {term && state.kind === "error" && <p className="text-amber-800">{state.message}</p>}
        {term && state.kind === "ready" && !state.demand.found && (
          <p className="text-slate-600">
            Запросов со словом «{term}» нет среди 400 главных запросов предметов {state.demand.subjectsChecked.join(", ")}: спрос небольшой или на WB это называют иначе — уточните «Запрос на WB».
          </p>
        )}
        {term && state.kind === "ready" && state.demand.found && (
          <div className="flex flex-col gap-3">
            <p className="text-slate-800">
              Запросы со словом «{term}»: <b>{num(state.demand.total)}</b> поисков за {dm(state.demand.period.from)}–{dm(state.demand.period.to)}
              {state.demand.growthPct !== null && (
                <span className={state.demand.growthPct >= 0 ? "text-green-700" : "text-red-700"}> ({state.demand.growthPct >= 0 ? "+" : ""}{state.demand.growthPct}% к прошлым 30 дням)</span>
              )}
            </p>
            {state.demand.subjects.map((s) => (
              <div key={s.subject} className="flex flex-col gap-1">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Предмет «{s.subject}»</div>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {s.queries.map((q) => (
                    <li key={q.word} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                      <span className="text-slate-800">{q.word}</span>
                      <span className="text-xs text-slate-500">
                        {num(q.now)} поисков
                        {q.before !== null ? ` · было ${num(q.before)}` : " · новый в топе"}
                        {q.items !== null && ` · товаров ${num(q.items)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
