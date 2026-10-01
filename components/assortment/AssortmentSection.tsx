"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  ASSORTMENT_BASE_PATH,
  ASSORTMENT_LAST_SECTION_KEY,
  DIRECTION_BRANDS,
  DIRECTION_LABEL,
  type AssortmentDirection,
} from "@/lib/assortment/constants";
import { summarizeCoverage } from "@/lib/assortment/coverage";
import { useAssortmentSources } from "./useAssortmentSources";

/**
 * Раздел модуля «Разработка ассортимента»: лента находок.
 *
 * Этап 1, первая часть: покрытие источников и пустая лента. Добавление
 * находок и галерея — следующий шаг; кнопку «Добавить находку» до него не
 * показываем вовсе, а не делаем неактивной.
 */
export function AssortmentSection({ direction }: { direction: AssortmentDirection }) {
  const state = useAssortmentSources(direction);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSORTMENT_LAST_SECTION_KEY, direction);
    } catch {
      // Без хранилища корень модуля просто откроет «Куртки».
    }
  }, [direction]);

  const coverage = state.kind === "ready" ? summarizeCoverage(state.sources) : null;

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">{DIRECTION_LABEL[direction]}</h1>
          <div className="text-sm text-slate-500">{DIRECTION_BRANDS[direction]}</div>
        </header>

        {state.kind === "error" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>
        )}
        {coverage && (
          <p className="text-sm leading-6 text-slate-600">
            {coverage.auto.length > 0 ? `Отслеживаем автоматически: ${coverage.auto.join(", ")}.` : "Автоматический сбор пока не подключён."}
            {coverage.partial.length > 0 && ` Частично: ${coverage.partial.join(", ")}.`}
            {coverage.manual.length > 0 && ` Только вручную: ${coverage.manual.join(", ")}.`}
            {" "}
            <Link href={`${ASSORTMENT_BASE_PATH}/sources`} className="font-medium text-violet-700 hover:text-violet-900">Все источники</Link>
          </p>
        )}

        <section className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <div className="text-base font-semibold text-slate-900">Находок пока нет</div>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            Лента появится, когда в раздел начнут попадать модели: добавление ссылок и фото — в следующем обновлении модуля,
            автоматический обход каталогов — после него.
          </p>
        </section>
      </div>
    </div>
  );
}
