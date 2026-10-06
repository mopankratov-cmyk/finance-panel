"use client";

import { useMemo, useState } from "react";
import { ACCESS_STATUS_LABEL, DIRECTION_LABEL, type AccessStatus, type AssortmentDirection } from "@/lib/assortment/constants";
import { ObservationState } from "./ObservationState";
import { SourcesList } from "./SourcesList";
import { useAssortmentSources } from "./useAssortmentSources";

type Filter = "all" | AssortmentDirection;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "jackets", label: DIRECTION_LABEL.jackets },
  { value: "bags", label: DIRECTION_LABEL.bags },
];

const SUMMARY: AccessStatus[] = ["auto_verified", "partial", "manual_only", "disabled", "untested", "not_connected"];

/** Экран «Источники»: что отслеживается и с каким доступом, по обоим разделам. */
export function AssortmentSources() {
  const [filter, setFilter] = useState<Filter>("all");
  const state = useAssortmentSources(filter === "all" ? null : filter);
  const counts = useMemo(() => {
    const result = new Map<AccessStatus, number>();
    if (state.kind === "ready") for (const s of state.sources) result.set(s.accessStatus, (result.get(s.accessStatus) ?? 0) + 1);
    return result;
  }, [state]);

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">Источники</h1>
          <p className="text-sm text-slate-500">Паспорт источников из ТЗ. Статус доступа — по факту проверки, а не по описанию сайта.</p>
        </header>

        <div role="radiogroup" aria-label="Раздел" className="flex gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={
                filter === item.value
                  ? "h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white"
                  : "h-10 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем паспорт источников…</div>}
        {state.kind === "error" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>
        )}
        {state.kind === "ready" && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
              {SUMMARY.filter((status) => counts.get(status)).map((status) => (
                <span key={status}>{ACCESS_STATUS_LABEL[status]}: <b className="text-slate-900">{counts.get(status)}</b></span>
              ))}
            </div>
            <ObservationState sources={state.sources} />
            <SourcesList sources={state.sources} />
          </>
        )}
      </div>
    </div>
  );
}
