"use client";

import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { MIN_MODELS_FOR_TRAITS, MIN_VISIBLE_FOR_SHARES, PRELIMINARY_COVERAGE, type PhotoTraitsReport } from "@/lib/assortment/catalogAi";
import type { PhotoSample } from "@/lib/assortment/catalogAiStore";
import { plural } from "@/lib/warehouse/plural";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

/**
 * Признаки каталога по фото — оценка ИИ. Доли прячутся, пока разобрано меньше
 * MIN_MODELS_FOR_TRAITS моделей: по горстке моделей они ничего не значат. А примеры
 * разбора (фото рядом с тем, что написал ИИ) видны сразу, с первой разобранной модели:
 * сверить описание с картинкой можно и на десяти.
 */
export function PhotoTraits({ direction }: { direction: AssortmentDirection }) {
  const [report, setReport] = useState<PhotoTraitsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    fetch(`/api/assortment-development/photo-traits?direction=${direction}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body?.error || `Не загрузилось (${response.status})`);
        else if (body?.report) setReport(body.report as PhotoTraitsReport);
      })
      .catch(() => {
        if (!cancelled) setError("Нет связи с сервером");
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  // Сбой чтения не прячем: молчание выглядело бы как «разбора нет». Пока ничего не разобрано (report пуст) — блока нет.
  if (error) return <PhotoTraitsError message={error} />;
  if (!report) return null;
  const ready = report.analyzed >= MIN_MODELS_FOR_TRAITS && report.fields.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {ready ? <TraitsSection report={report} /> : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
          Признаки по фото: разобрано {num(report.analyzed)} из {num(report.catalog)} {plural(report.catalog, "модели", "моделей", "моделей")} с фото. Доли по признакам появятся, когда разобрано будет хотя бы {MIN_MODELS_FOR_TRAITS}; а как ИИ описывает фото, можно посмотреть уже сейчас — на примерах ниже.
          {(report.legacy ?? 0) > 0 && ` Ещё ${num(report.legacy)} ${plural(report.legacy, "модель разобрана", "модели разобраны", "моделей разобрано")} по прежнему вопросу: в долях они не участвуют и пересоберутся.`}
        </p>
      )}
      <PhotoSamples direction={direction} />
    </div>
  );
}

/** Признаки по фото не загрузились — говорим об этом, а не молчим. */
export function PhotoTraitsError({ message }: { message: string }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Признаки по фото не загрузились: {message}.</p>;
}

export function TraitsSection({ report }: { report: PhotoTraitsReport }) {
  return (
    <section aria-label="Признаки по фото" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Признаки по фото — оценка ИИ
          {report.coverage < PRELIMINARY_COVERAGE && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-normal text-amber-800">предварительно</span>}
        </h2>
        <span className="text-xs text-slate-500">
          разобрано {num(report.analyzed)} из {num(report.catalog)} {plural(report.catalog, "модели", "моделей", "моделей")} с фото ({pct(report.coverage)})
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {report.fields.map((field) => {
          const shown = field.values.slice(0, 5);
          const other = field.other;
          // Модели в значениях за пятой строкой: без этой строки полоски и «другие формулировки» не сходятся к «видно у N».
          const hidden = Math.max(0, field.visible - shown.reduce((sum, v) => sum + v.models, 0) - (other?.models ?? 0));
          const examples = (other?.examples ?? []).map((e) => `«${e.text}»${e.models > 1 ? ` ×${e.models}` : ""}`).join(", ");
          const unshown = [
            hidden > 0 ? `редкие значения — ${num(hidden)} ${plural(hidden, "модель", "модели", "моделей")}` : null,
            other ? `другие формулировки — ${num(other.models)} ${plural(other.models, "модель", "модели", "моделей")}${examples ? ` (${examples})` : ""}` : null,
          ].filter(Boolean);
          const tooFew = field.visible < MIN_VISIBLE_FOR_SHARES;
          const base = (v: (typeof shown)[number]) => v.avgSourceShare ?? v.share;
          return (
            <div key={field.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{field.label}</span>
                <span className="text-xs text-slate-500">видно у {num(field.visible)} · не видно {num(field.notVisible)}</span>
              </div>
              {tooFew ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">Мало данных: признак виден у {num(field.visible)} {plural(field.visible, "модели", "моделей", "моделей")}, доли покажем, когда будет {MIN_VISIBLE_FOR_SHARES} и больше.</p>
              ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {shown.map((v) => (
                  <li key={v.value} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm text-slate-800">
                      <span className="break-anywhere">{v.value}</span>
                      <span className="shrink-0 text-xs text-slate-600">{pct(base(v))} <span className="text-slate-400">· {num(v.models)}</span></span>
                    </div>
                    <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(1, base(v)))}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              )}
              {!tooFew && unshown.length > 0 && <p className="mt-2 text-xs text-slate-500">Не показано: {unshown.join("; ")}.</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Это оценка ИИ по фото модели (до двух), а не факт с сайта и не ручная проверка: что на фото не видно, ИИ не угадывает, и такие модели в долях признака не участвуют.
        Полоска — доля от 100%, а не от самого частого значения. {report.basis === "averaged"
          ? `Доля — средняя по источникам (учтено ${report.sourcesInAverage}, у каждого не меньше 10 разобранных моделей; вместе они дают ${Math.round(report.averageCoverage * 100)}% разобранного): большой каталог не решает за остальные.`
          : "Пока разобрано мало: источников с 10 и более разобранными моделями недостаточно, чтобы усреднять, поэтому доли — по всем разобранным моделям и зависят от того, какие источники успели разобраться; средняя по источникам включится, когда такие источники будут давать 80% разобранного."}
        {" "}Пока разобрана не вся витрина, картина может сместиться.
        {(report.legacy ?? 0) > 0 && ` Ещё ${num(report.legacy)} ${plural(report.legacy, "модель разобрана", "модели разобраны", "моделей разобрано")} по прежнему вопросу: в долях они не участвуют и пересоберутся.`}
        {" "}Цен нет.
      </p>
    </section>
  );
}

/** Примеры разбора: модель — фото, название и то, что про неё написал ИИ. Сверить с картинкой. */
function PhotoSamples({ direction }: { direction: AssortmentDirection }) {
  const [state, setState] = useState<{ kind: "closed" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; samples: PhotoSample[]; analyzed: number }>({ kind: "closed" });

  useEffect(() => setState({ kind: "closed" }), [direction]);

  const load = () => {
    setState({ kind: "loading" });
    const seed = Math.random().toString(36).slice(2, 10);
    fetch(`/api/assortment-development/photo-traits?direction=${direction}&samples=1&seed=${seed}&limit=12`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body?.result) setState({ kind: "error", message: body?.error || `Примеры не загрузились (${r.status})` });
        else setState({ kind: "ready", samples: body.result.samples as PhotoSample[], analyzed: Number(body.result.analyzed) || 0 });
      })
      .catch(() => setState({ kind: "error", message: "Нет связи с сервером" }));
  };

  return (
    <section aria-label="Проверка разбора" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Проверить разбор на примерах</h3>
        <button type="button" onClick={load} disabled={state.kind === "loading"} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60">
          {state.kind === "ready" ? "Другие примеры" : state.kind === "loading" ? "Загружаем…" : "Показать 12 случайных моделей"}
        </button>
      </div>
      {state.kind === "closed" && <p className="text-xs leading-5 text-slate-500">Фото рядом с тем, что написал ИИ: так видно, где он ошибается, прежде чем верить долям выше. Выборка идёт по кругу между источниками.</p>}
      {state.kind === "error" && <p className="text-sm text-amber-800">{state.message}</p>}
      {state.kind === "ready" && state.samples.length === 0 && <p className="text-sm text-slate-600">Пока нечего показывать: разобранных моделей из текущего каталога нет.</p>}
      {state.kind === "ready" && state.samples.length > 0 && (
        <>
          <SampleCards samples={state.samples} />
          <p className="text-xs leading-5 text-slate-500">Из {num(state.analyzed)} разобранных. Это оценка ИИ по фото: она ошибается, «не видно» — честный ответ, а не пропуск. Если неверно слишком часто, скажите — поправим вопрос или модель.</p>
        </>
      )}
    </section>
  );
}

/** Карточки примеров — отдельно от загрузки, чтобы их можно было показать на любых данных. */
export function SampleCards({ samples }: { samples: PhotoSample[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {samples.map((sample) => (
        <article key={`${sample.sourceId}:${sample.title}:${sample.takenAt}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
          <div className="flex gap-3">
            {sample.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sample.imageUrl} alt={sample.title} loading="lazy" referrerPolicy="no-referrer" className="h-32 w-24 shrink-0 rounded-lg bg-slate-100 object-cover" />
            ) : (
              <div className="grid h-32 w-24 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs text-slate-400">нет фото</div>
            )}
            <div className="min-w-0">
              <div className="break-anywhere text-sm font-medium text-slate-900">{sample.title || "Без названия"}</div>
              <div className="text-xs text-slate-500">{sample.sourceName}</div>
              {sample.model && <div className="text-[11px] text-slate-400">{sample.model}</div>}
            </div>
          </div>
          <dl className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-x-2 gap-y-0.5 text-xs">
            {sample.attributes.map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-slate-500">{a.label}</dt>
                <dd className={a.notVisible ? "text-slate-400" : "text-slate-800"}>
                  {a.notVisible ? "не видно" : a.value}
                  {!a.notVisible && a.confidence !== null && a.confidence < 0.6 && <span className="text-amber-700"> · неуверенно</span>}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
