"use client";

import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import type { FormRow, FormsReport } from "@/lib/assortment/forms";
import type { FormDemandReport } from "@/lib/assortment/wbQueries";
import { FormDemand } from "./FormDemand";
import { plural } from "@/lib/warehouse/plural";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: FormsReport; demand: FormDemandReport | null };

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

/**
 * Формы моделей каталога по названиям. Это срез на сегодня, а не динамика: история
 * наблюдений только начинает копиться. Признак один — название модели; не фото.
 */
export function FormsView({ direction }: { direction: AssortmentDirection }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/forms?direction=${direction}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !body?.report) {
          setState({ kind: "error", message: body?.error || `Формы не загрузились (${response.status})` });
          return;
        }
        setState({ kind: "ready", report: body.report as FormsReport, demand: (body.demand as FormDemandReport | null) ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  if (state.kind === "loading") {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Считаем формы…</div>;
  }
  if (state.kind === "error") {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>;
  }

  return <FormsReportView report={state.report} demand={state.demand} />;
}

/** Отчёт по формам — отдельно от загрузки: его можно показать на любых данных. */
export function FormsReportView({ report, demand = null }: { report: FormsReport; demand?: FormDemandReport | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showUnrecognized, setShowUnrecognized] = useState(false);
  if (report.models === 0) {
    return (
      <section className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <div className="text-base font-semibold text-slate-900">В каталоге пока нет моделей</div>
        <p className="max-w-xl text-sm leading-6 text-slate-600">Формы появятся, когда обходы принесут модели брендов.</p>
      </section>
    );
  }

  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const max = Math.max(...report.rows.map((r) => r.share), 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
        <p>
          <b>{num(report.models)}</b> {plural(report.models, "модель", "модели", "моделей")} у <b>{report.sourcesCount}</b> {plural(report.sourcesCount, "источник", "источника", "источников")}.
          Форма названа у <b>{pct(report.coverage)}</b>, а конкретная (не просто «куртка» или «сумка») — у <b>{pct(report.specificCoverage)}</b>.
        </p>
        <p className="mt-1 text-slate-500">
          Форма определена по названию модели, а не по фото. Это срез на сегодня, а не динамика: история наблюдений только накапливается, и «растёт» или «падает» пока сказать нельзя.
          Каждая модель считается один раз — расцветки склеены.
        </p>
      </div>

      <section aria-label="Формы" className="flex flex-col gap-2">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_72px_84px_104px_80px] gap-3 px-3 text-xs text-slate-500 md:grid">
          <span>Форма</span>
          <span className="text-right">Моделей</span>
          <span className="text-right">Доля каталога</span>
          <span className="text-right" title="Каждый источник весит одинаково: большой каталог не делает форму «сильнее»">Средняя по источникам</span>
          <span className="text-right">Источников</span>
        </div>
        {report.rows.map((row) => <FormLine key={row.key} row={row} max={max} open={open.has(row.key)} onToggle={() => toggle(row.key)} />)}
      </section>

      <FormDemand report={report} demand={demand} />

      {report.traits.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Уточнения из названий</h2>
          <div className="chip-row flex flex-wrap gap-2">
            {report.traits.map((t) => (
              <span key={t.key} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700">
                {t.label} · {num(t.models)} <span className="text-slate-400">({pct(t.share)})</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {report.unrecognized.count > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <button type="button" onClick={() => setShowUnrecognized((v) => !v)} className="flex w-full items-center gap-2 text-left text-sm font-medium text-slate-900">
            {showUnrecognized ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Название не называет форму: {num(report.unrecognized.count)} {plural(report.unrecognized.count, "модель", "модели", "моделей")}
          </button>
          {showUnrecognized && (
            <div className="mt-2 text-sm leading-6 text-slate-600">
              <p>
                Например: {report.unrecognized.samples.join(" · ")}. Это имена моделей без слова о форме (так у части брендов сумок)
                или обрывки описаний. Их форма определится по фото, когда признаки по фото дойдут до всего каталога.
              </p>
            </div>
          )}
        </section>
      )}

      <p className="text-xs leading-5 text-slate-500">
        Источник — не бренд: ASOS одним источником считает Mango, Bershka и другие бренды внутри себя, поэтому «источников» у формы может быть меньше, чем брендов.
        Цен здесь нет и не будет.
      </p>
    </div>
  );
}

function FormLine({ row, max, open, onToggle }: { row: FormRow; max: number; open: boolean; onToggle: () => void }) {
  const top = row.perSource[0];
  return (
    <div className={`rounded-xl border bg-white ${row.generic ? "border-dashed border-slate-300" : "border-slate-200"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-col gap-2 px-3 py-3 text-left md:grid md:grid-cols-[minmax(0,1.6fr)_72px_84px_104px_80px] md:items-center md:gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
            <span className={`break-anywhere text-sm font-medium ${row.generic ? "text-slate-500" : "text-slate-900"}`}>{row.label}</span>
          </span>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className={`block h-full rounded-full ${row.generic ? "bg-slate-300" : "bg-violet-500"}`} style={{ width: `${Math.max(2, (row.share / max) * 100)}%` }} />
          </span>
        </span>
        <span className="flex gap-4 text-sm text-slate-700 md:contents">
          <span className="md:text-right"><span className="text-xs text-slate-400 md:hidden">Моделей </span>{num(row.models)}</span>
          <span className="md:text-right"><span className="text-xs text-slate-400 md:hidden">Доля </span>{pct(row.share)}</span>
          <span className="md:text-right"><span className="text-xs text-slate-400 md:hidden">Средняя по источникам </span>{row.avgSourceShare == null ? "—" : pct(row.avgSourceShare)}</span>
          <span className="md:text-right"><span className="text-xs text-slate-400 md:hidden">Источников </span>{row.sources}</span>
        </span>
      </button>
      {row.concentrated && top && (
        <p className="px-3 pb-2 text-xs leading-5 text-amber-800">
          Почти всё у одного источника: {top.name} — {pct(row.topSourceShare)}. Это ассортимент бренда, а не распространение формы.
        </p>
      )}
      {open && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
          {row.perSource.map((s) => (
            <span key={s.sourceId}>{s.name} — {num(s.count)} <span className="text-slate-400">({pct(s.pct)} каталога источника)</span></span>
          ))}
        </div>
      )}
    </div>
  );
}
