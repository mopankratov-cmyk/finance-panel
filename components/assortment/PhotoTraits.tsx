"use client";

import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { MIN_MODELS_FOR_TRAITS, type PhotoTraitsReport } from "@/lib/assortment/catalogAi";
import { plural } from "@/lib/warehouse/plural";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

/**
 * Признаки каталога по фото — оценка ИИ. Блок прячется, пока разобрано меньше
 * MIN_MODELS_FOR_TRAITS моделей: доли по горстке моделей ничего не значат.
 */
export function PhotoTraits({ direction }: { direction: AssortmentDirection }) {
  const [report, setReport] = useState<PhotoTraitsReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    fetch(`/api/assortment-development/photo-traits?direction=${direction}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.report) setReport(body.report as PhotoTraitsReport);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [direction]);

  if (!report || report.analyzed < MIN_MODELS_FOR_TRAITS || report.fields.length === 0) return null;

  return (
    <section aria-label="Признаки по фото" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Признаки по фото — оценка ИИ</h2>
        <span className="text-xs text-slate-500">
          разобрано {num(report.analyzed)} из {num(report.catalog)} {plural(report.catalog, "модели", "моделей", "моделей")} с фото ({pct(report.coverage)})
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {report.fields.map((field) => {
          const shown = field.values.slice(0, 5);
          const other = field.other;
          const base = (v: (typeof shown)[number]) => v.avgSourceShare ?? v.share;
          return (
            <div key={field.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{field.label}</span>
                <span className="text-xs text-slate-500">видно у {num(field.visible)} · не видно {num(field.notVisible)}</span>
              </div>
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
              {other && <p className="mt-2 text-xs text-slate-500">Другие формулировки — {num(other.models)} {plural(other.models, "модель", "модели", "моделей")}.</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Это оценка ИИ по фото модели (до двух), а не факт с сайта и не ручная проверка: что на фото не видно, ИИ не угадывает, и такие модели в долях признака не участвуют.
        Полоска — доля от 100%, а не от самого частого значения. Доля — средняя по источникам{report.sourcesInAverage > 0 ? ` (учтено источников: ${report.sourcesInAverage}, у каждого — не меньше 10 разобранных моделей)` : " (источников с достаточным числом разобранных моделей пока нет — показаны сырые доли)"}:
        большой каталог не решает за остальные. Пока разобрана не вся витрина, картина может сместиться. Цен нет.
      </p>
    </section>
  );
}
