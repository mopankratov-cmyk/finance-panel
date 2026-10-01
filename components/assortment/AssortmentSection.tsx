"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ACCESS_STATUS_LABEL,
  ASSORTMENT_BASE_PATH,
  ASSORTMENT_DIRECTIONS,
  ASSORTMENT_LAST_SECTION_KEY,
  DIRECTION_BRANDS,
  DIRECTION_LABEL,
  type AccessStatus,
  type AssortmentDirection,
} from "@/lib/assortment/constants";
import { summarizeCoverage, type AssortmentSource } from "@/lib/assortment/coverage";

const STATUS_STYLE: Record<AccessStatus, string> = {
  auto_verified: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-900",
  manual_only: "bg-slate-200 text-slate-700",
  untested: "bg-blue-100 text-blue-800",
  unavailable: "bg-red-50 text-red-800",
  disabled: "bg-slate-100 text-slate-600",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sources: AssortmentSource[] };

/**
 * Раздел модуля «Разработка ассортимента».
 *
 * Этап 1, первая часть: паспорт источников раздела и пустая лента. Добавление
 * находок и галерея — следующий шаг; кнопку «Добавить находку» до него не
 * показываем вовсе, а не делаем неактивной.
 */
export function AssortmentSection({ direction }: { direction: AssortmentDirection }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSORTMENT_LAST_SECTION_KEY, direction);
    } catch {
      // Без хранилища корень модуля просто откроет «Куртки».
    }
  }, [direction]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/sources?direction=${direction}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setState({ kind: "error", message: body?.error || `Не удалось загрузить источники (${response.status})` });
          return;
        }
        setState({ kind: "ready", sources: Array.isArray(body?.sources) ? body.sources : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  const coverage = state.kind === "ready" ? summarizeCoverage(state.sources) : null;

  return (
    <div className="min-h-[calc(100dvh-54px)] bg-[#f6f7f9] px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <div className="text-xs text-slate-500">Разработка ассортимента</div>
          <h1 className="text-2xl font-semibold text-slate-900">{DIRECTION_LABEL[direction]}</h1>
          <div className="text-sm text-slate-500">{DIRECTION_BRANDS[direction]}</div>
        </header>

        <nav aria-label="Раздел" className="flex gap-2">
          {ASSORTMENT_DIRECTIONS.map((item) => (
            <Link
              key={item}
              href={`${ASSORTMENT_BASE_PATH}/${item}`}
              aria-current={item === direction ? "page" : undefined}
              className={
                item === direction
                  ? "inline-flex h-10 items-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white"
                  : "inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
              }
            >
              {DIRECTION_LABEL[item]}
            </Link>
          ))}
        </nav>

        {coverage && (
          <p className="text-sm leading-6 text-slate-600">
            {coverage.auto.length > 0 ? `Отслеживаем автоматически: ${coverage.auto.join(", ")}.` : "Автоматический сбор пока не подключён."}
            {coverage.partial.length > 0 && ` Частично: ${coverage.partial.join(", ")}.`}
            {coverage.manual.length > 0 && ` Только вручную: ${coverage.manual.join(", ")}.`}
          </p>
        )}

        <section className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <div className="text-base font-semibold text-slate-900">Находок пока нет</div>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            Лента появится, когда в раздел начнут попадать модели: добавление ссылок и фото — в следующем обновлении модуля,
            автоматический обход каталогов — после него.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-900">Источники раздела</h2>
          {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем паспорт источников…</div>}
          {state.kind === "error" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>
          )}
          {state.kind === "ready" && (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {state.sources.map((source) => (
                <li key={source.sourceId} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-slate-900">{source.name}</span>
                    <span className="font-mono text-[11px] text-slate-500">{source.sourceId}</span>
                  </div>
                  <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[source.accessStatus]}`}>
                    {ACCESS_STATUS_LABEL[source.accessStatus]}
                  </span>
                  {source.accessNote && <span className="text-xs leading-5 text-slate-600">{source.accessNote}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
