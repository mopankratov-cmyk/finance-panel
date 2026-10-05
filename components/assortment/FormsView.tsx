"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { FORM_UNRECOGNIZED } from "@/lib/assortment/catalog";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";
import { MIN_SOURCE_MODELS, type FormRow, type FormsReport } from "@/lib/assortment/forms";
import { fitFor, type BrandProfile } from "@/lib/assortment/brandProfiles";
import type { FormDemandReport } from "@/lib/assortment/wbQueries";
import { DataReadiness } from "./DataReadiness";
import { FormDemand } from "./FormDemand";
import { PhotoTraits } from "./PhotoTraits";
import { plural } from "@/lib/warehouse/plural";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: FormsReport; demand: FormDemandReport | null; profiles: BrandProfile[] };

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

/**
 * Формы моделей каталога по названиям. Это срез на сегодня, а не динамика: история
 * наблюдений только начинает копиться. Признак один — название модели; не фото.
 */
export function FormsView({ direction, onShowModels }: { direction: AssortmentDirection; onShowModels?: (form: string) => void }) {
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
        setState({ kind: "ready", report: body.report as FormsReport, demand: (body.demand as FormDemandReport | null) ?? null, profiles: Array.isArray(body.profiles) ? (body.profiles as BrandProfile[]) : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  // Полоска «На чём стоят цифры» грузится сама, не дожидаясь «Форм»: у неё свой запрос, и она не должна появляться над уже читаемым отчётом.
  return (
    <div className="flex flex-col gap-5">
      <DataReadiness direction={direction} />
      {state.kind === "loading" && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Считаем формы…</div>}
      {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {state.kind === "ready" && (
        <>
          <FormsReportView report={state.report} demand={state.demand} profiles={state.profiles} onShowModels={onShowModels} />
          <PhotoTraits direction={direction} />
        </>
      )}
    </div>
  );
}

/** Отчёт по формам — отдельно от загрузки: его можно показать на любых данных. */
export function FormsReportView({ report, demand = null, profiles = [], unrecognizedOpen = false, openForms = [], onShowModels }: { report: FormsReport; demand?: FormDemandReport | null; profiles?: BrandProfile[]; unrecognizedOpen?: boolean; openForms?: string[]; onShowModels?: (form: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set(openForms));
  const [showUnrecognized, setShowUnrecognized] = useState(unrecognizedOpen);
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
          <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">расчёт по названиям</span>
          Форма определена по названию модели, а не по фото. Это срез на сегодня, а не динамика: история наблюдений только накапливается, и «растёт» или «падает» пока сказать нельзя.
          Расцветки одной модели склеены у JW PEI, Polène, Songmont, Rains и ASOS, где сайт отдаёт каждый цвет отдельным товаром; у остальных источников строка каталога — это модель так, как её отдаёт сайт, а у H&M каждая расцветка — отдельная карточка, поэтому его модели могут считаться несколько раз.
          «Средняя по источникам» — каждый источник с каталогом от {MIN_SOURCE_MODELS} моделей весит одинаково: большой каталог не делает форму «сильнее».
        </p>
      </div>

      <section aria-label="Формы" className="flex flex-col gap-2">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_72px_84px_104px_80px] gap-3 px-3 text-xs text-slate-500 md:grid">
          <span>Форма</span>
          <span className="text-right">Моделей</span>
          <span className="text-right">Доля каталога</span>
          <span className="text-right">Средняя по источникам</span>
          <span className="text-right">Источников</span>
        </div>
        {report.rows.map((row) => <FormLine key={row.key} row={row} max={max} open={open.has(row.key)} onToggle={() => toggle(row.key)} profiles={profiles} direction={report.direction} showModels={report.viaHeads !== false} onShowModels={onShowModels} />)}
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
                или обрывки описаний. Форму таких моделей мы не определяем и не угадываем: ни одной формы они не прибавляют, но в знаменателе долей («Доля каталога», «Средняя по источникам») остаются — это доля от всего каталога, а не только от моделей с названной формой.
                Как их описывает ИИ по фото, видно в блоке «Признаки по фото» ниже — но это отдельная оценка, она в эти доли не входит.
              </p>
              {report.viaHeads !== false && <div className="mt-2"><ModelsLink direction={report.direction} form={FORM_UNRECOGNIZED} count={report.unrecognized.count} onShow={onShowModels} /></div>}
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

function FormLine({ row, max, open, onToggle, profiles, direction, showModels, onShowModels }: { row: FormRow; max: number; open: boolean; onToggle: () => void; profiles: BrandProfile[]; direction: AssortmentDirection; showModels: boolean; onShowModels?: (form: string) => void }) {
  const top = row.perSource[0];
  const decisions = profiles.map((p) => ({ profile: p, fit: fitFor(p, row.key) })).filter((d) => d.fit !== null);
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
      {decisions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {decisions.map(({ profile, fit }) => (
            <span
              key={profile.brandKey}
              className={`rounded-full px-2.5 py-0.5 text-xs ${fit === "fit" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
            >
              {profile.displayName}: {fit === "fit" ? "подходит" : "не подходит"}{profile.status === "confirmed" ? "" : " (черновик)"}
            </span>
          ))}
        </div>
      )}
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
          {showModels && <ModelsLink direction={direction} form={row.key} count={row.models} onShow={onShowModels} />}
        </div>
      )}
    </div>
  );
}

/**
 * Переход от формы к моделям: каталог с фильтром «Форма». Режим «и без фото» включён, чтобы число в каталоге совпало со
 * строкой формы: «Формы» считают все модели, а не только с фото. Внутри раздела — кнопка (раздел сам перестраивает каталог,
 * повторный переход к той же форме работает); отдельно от раздела — ссылка с адресом, который можно переслать.
 */
export function ModelsLink({ direction, form, count, onShow }: { direction: AssortmentDirection; form: string; count: number; onShow?: (form: string) => void }) {
  const className = "inline-flex h-10 items-center rounded-lg border border-violet-300 bg-violet-50 px-3 text-xs font-medium text-violet-900 hover:bg-violet-100";
  if (onShow) {
    return <button type="button" onClick={() => onShow(form)} className={className}>Показать модели · {num(count)}</button>;
  }
  return (
    <Link href={`${ASSORTMENT_BASE_PATH}/${direction}?view=catalog&form=${encodeURIComponent(form)}&photo=all`} className={className}>
      Показать модели · {num(count)}
    </Link>
  );
}
