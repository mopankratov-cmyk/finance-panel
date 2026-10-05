"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import type { ReadinessReport } from "@/lib/assortment/dataReadiness";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; report: ReadinessReport };

/**
 * «На чём стоят цифры» над «Формами»: сколько разобрано по фото, свежесть спроса WB, глубина истории и даты, с которых
 * функции станут честными. Свёрнута; раскрыта сама, только если что-то требует внимания (нет ключа, бюджет кончился,
 * срез не снялся, много неразобранных).
 */
export function DataReadiness({ direction }: { direction: AssortmentDirection }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/data-readiness?direction=${direction}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !body?.report) setState({ kind: "error", message: body?.error || `Не загрузилось (${response.status})` });
        else setState({ kind: "ready", report: body.report as ReadinessReport });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Состояние данных не загрузилось: {state.message}.</p>;
  }
  return <ReadinessStrip report={state.report} />;
}

const KIND_STYLE: Record<string, string> = { факт: "bg-slate-100 text-slate-600", расчёт: "bg-sky-50 text-sky-800", оценка: "bg-amber-50 text-amber-800" };

/** Сама полоска — отдельно от загрузки, чтобы её можно было показать на любых данных. */
export function ReadinessStrip({ report }: { report: ReadinessReport }) {
  const [open, setOpen] = useState(report.problem);
  // Сбой чтения части называем всегда, даже когда остальное свёрнуто или данных больше нет: молчание выглядело бы как «данных нет».
  const errors = (report.errors ?? []).length > 0
    ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Не загрузилось: {(report.errors ?? []).join("; ")}.</p>
    : null;
  if (report.groups.length === 0) return errors;
  return (
    <div className="flex flex-col gap-2">
      {errors}
      <ReadinessGroups report={report} open={open} setOpen={setOpen} />
    </div>
  );
}

function ReadinessGroups({ report, open, setOpen }: { report: ReadinessReport; open: boolean; setOpen: (fn: (v: boolean) => boolean) => void }) {
  return (
    <section aria-label="На чём стоят цифры" className={`rounded-xl border bg-white ${report.problem ? "border-amber-300" : "border-slate-200"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="shrink-0 font-medium text-slate-900">На чём стоят цифры</span>
          <span className="min-w-0 text-xs leading-5 text-slate-500 sm:text-sm">{report.groups.map((g) => `${g.title}: ${g.summary}`).join(" · ")}</span>
        </span>
        {report.problem && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">нужно внимание</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-3">
          {report.groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
              <ul className="flex flex-col gap-1">
                {group.lines.map((line, i) => (
                  <li key={i} className={`flex items-start gap-2 text-xs leading-5 ${line.problem ? "text-amber-900" : "text-slate-700"}`}>
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] ${KIND_STYLE[line.kind] ?? KIND_STYLE.факт}`}>{line.kind}</span>
                    <span className="break-anywhere">{line.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs leading-5 text-slate-500">
            Даты — расчёт по текущим порогам, а не обещание. Функции, у которых данных ещё нет, здесь и на экране не показываются. Цен нет.
          </p>
        </div>
      )}
    </section>
  );
}
