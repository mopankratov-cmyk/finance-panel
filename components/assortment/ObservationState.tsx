"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssortmentSource } from "@/lib/assortment/coverage";
import { HISTORY_STATUS_HINT, HISTORY_STATUS_LABEL, type HistoryStatus, type SourceHistory } from "@/lib/assortment/observationState";
import { plural } from "@/lib/warehouse/plural";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; available: boolean; sources: SourceHistory[] };

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const CHIP: Record<HistoryStatus, string> = {
  none: "bg-slate-100 text-slate-600",
  building: "bg-amber-50 text-amber-800",
  window_only: "bg-slate-100 text-slate-700",
  appearance: "bg-sky-50 text-sky-800",
  dynamics: "bg-green-50 text-green-800",
};

/**
 * «Состояние данных»: сколько истории наблюдений накоплено по источникам и чему
 * на ней уже можно верить. История копится с первого обхода после выкладки слоя
 * наблюдений и не наверстывается задним числом.
 */
export function ObservationState({ sources }: { sources: AssortmentSource[] }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assortment-development/observation-state")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body?.sources)) setState({ kind: "error", message: body?.error || `Состояние данных не загрузилось (${response.status})` });
        else setState({ kind: "ready", available: Boolean(body.available), sources: body.sources });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const names = new Map(sources.map((s) => [s.sourceId, s.name]));

  return (
    <section aria-label="История наблюдений" className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">История наблюдений</h2>
      {state.kind === "loading" && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Читаем журнал прогонов…</div>}
      {state.kind === "error" && <p className="text-sm text-amber-800">{state.message}</p>}
      {state.kind === "ready" && !state.available && (
        <p className="text-sm leading-6 text-slate-600">Журнал наблюдений ещё не создан: нужно применить миграцию 202610050001_assortment_observation_log.sql.</p>
      )}
      {state.kind === "ready" && state.available && state.sources.length === 0 && (
        <p className="text-sm leading-6 text-slate-600">
          Журнал пуст: история начнёт копиться с первого обхода после выкладки слоя наблюдений. Задним числом её не наверстать — «что появилось за месяц» можно будет сказать только про время после этого.
        </p>
      )}
      {state.kind === "ready" && state.sources.length > 0 && (
        <>
          <p className="text-xs leading-5 text-slate-500">
            Что уже можно утверждать по каждому источнику. «Появилось» и «пропало» — наблюдение от двух полных прогонов с разрывом неделя; динамика — от четырёх недель. Пороги — наше решение, не свойство данных.
          </p>
          <div className="flex flex-col divide-y divide-slate-100">
            {state.sources.map((h) => (
              <div key={h.sourceId} className="flex flex-col gap-1 py-2 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] md:items-center md:gap-3">
                <span className="text-sm font-medium text-slate-900">{names.get(h.sourceId) ?? h.sourceId}</span>
                <span>
                  <span title={HISTORY_STATUS_HINT[h.status]} className={`rounded-full px-2.5 py-1 text-xs font-medium ${CHIP[h.status]}`}>{HISTORY_STATUS_LABEL[h.status]}</span>
                </span>
                <span className="text-xs leading-5 text-slate-600">
                  {h.days} {plural(h.days, "день", "дня", "дней")} наблюдений
                  {h.firstDay ? ` с ${dm(h.firstDay)}` : ""}
                  {` · прогонов ${h.runs} (полных ${h.full}, по верху выдачи ${h.window}, оборванных ${h.partial})`}
                  {h.lastFullOn ? ` · последний полный ${dm(h.lastFullOn)}` : ""}
                  {h.lastError ? <span className="text-amber-800"> · последний оборван: {h.lastError.slice(0, 80)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
