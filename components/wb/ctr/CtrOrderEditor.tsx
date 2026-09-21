"use client";

import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Hint } from "@/components/ui/Hint";
import { moveInOrder } from "@/lib/ctrtest/stepPlan";
import { variantLetter } from "@/lib/ctrtest/roundHistory";

/**
 * Порядок вариантов по раундам.
 *
 * При фиксированном A-B-C вариант A всегда идёт первым, а общий CTR со временем
 * дрейфует, поэтому порядок сам смещает сравнение. По умолчанию порядок
 * сдвигается по кругу; здесь его можно поменять руками: у каждого раунда свой
 * список, и в нём вариант сдвигается вверх или вниз.
 *
 * Кнопки, а не перетаскивание: пальцем на телефоне и с клавиатуры это работает
 * одинаково, а перетаскивание нет.
 */
export function CtrOrderEditor({
  labels,
  orders,
  customized,
  onChange,
  onReset,
}: {
  /** Названия вариантов по позициям. */
  labels: string[];
  orders: number[][];
  customized: boolean;
  onChange: (orders: number[][]) => void;
  onReset: () => void;
}) {
  const move = (round: number, index: number, delta: -1 | 1) =>
    onChange(orders.map((order, roundIndex) => (roundIndex === round ? moveInOrder(order, index, delta) : order)));

  return (
    <section aria-label="Порядок вариантов по раундам" className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-bold text-slate-700">Порядок вариантов по раундам</h3>
        <Hint label="Зачем менять порядок">
          Если варианты идут всегда в одном порядке, первый оказывается в самое «сильное» время суток, а последний — в самое слабое, и часть разницы в CTR — это время, а не картинка. По умолчанию порядок сдвигается по кругу: A-B-C, затем B-C-A, затем C-A-B.
        </Hint>
        {customized ? (
          <button type="button" onClick={onReset} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <RotateCcw className="h-3.5 w-3.5" />Вернуть сдвиг по умолчанию
          </button>
        ) : (
          <span className="ml-auto text-[10px] text-slate-400">по умолчанию — сдвиг по кругу</span>
        )}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {orders.map((order, round) => (
          <div key={round} className="rounded-lg bg-slate-50 p-2">
            <div className="text-[10px] font-semibold text-slate-500">Раунд {round + 1}</div>
            <ol className="mt-1 space-y-1">
              {order.map((position, index) => {
                const label = labels[position] ?? variantLetter(position);
                return (
                  <li key={position} className="flex items-center gap-2 text-[11px] text-slate-700">
                    <span className="w-4 shrink-0 text-right text-slate-400">{index + 1}.</span>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[10px] font-bold text-violet-700 shadow-sm">{variantLetter(position)}</span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <button type="button" disabled={index === 0} onClick={() => move(round, index, -1)} aria-label={`Поднять «${label}» в раунде ${round + 1}`} className="tap grid shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white disabled:opacity-30">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={index === order.length - 1} onClick={() => move(round, index, 1)} aria-label={`Опустить «${label}» в раунде ${round + 1}`} className="tap grid shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white disabled:opacity-30">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
