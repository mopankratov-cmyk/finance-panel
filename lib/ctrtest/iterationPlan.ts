/**
 * Фаза B методологии CTR-тестов (ТЗ владельца 15.09.2026): сколько итераций
 * теста реально влезает в сутки на трафике ПРИВЯЗАННОЙ поисковой кампании —
 * не общем трафике товара (тот считает `ctrTestForecast`, и он остаётся:
 * отвечает на другой вопрос — «сколько продлится один проход по вариантам»).
 *
 * Часовых данных WB не отдаёт (только по дням), поэтому «высококонверсионные
 * часы» из ТЗ здесь не считаются вовсе — оценка на дневных средних, это
 * сознательный предел, а не недосмотр.
 */

/** Запас сверх голой арифметики: пример из ТЗ (2×4000 + ~2000 на 16000) —
 *  это ~12,5%; берём 15% в сторону надёжности, а не впритык. */
const ITERATION_BUFFER = 0.15;

export interface CtrIterationPlanInput {
  /** Средние показы в сутки на кампании, к которой привязан тест. null/0 — неизвестно. */
  dailyViews: number | null;
  /** Показов на вариант (цель раунда/варианта, как в мастере создания). */
  targetImpressions: number;
  variantCount: number;
}

export interface CtrIterationPlan {
  impressionsPerIteration: number;
  recommendedPerDay: number;
  /** null — суточный трафик кампании неизвестен, оценка невозможна. */
  iterationsPerDay: number | null;
  /** null — неизвестно; иначе хватает ли трафика хотя бы на одну итерацию в сутки. */
  feasible: boolean | null;
  text: string;
}

export function ctrIterationPlan(input: CtrIterationPlanInput): CtrIterationPlan {
  const impressionsPerIteration = Math.max(1, Math.round(input.targetImpressions)) * Math.max(1, Math.round(input.variantCount));
  const recommendedPerDay = Math.round(impressionsPerIteration * (1 + ITERATION_BUFFER));
  const dailyViews = input.dailyViews != null && input.dailyViews > 0 ? input.dailyViews : 0;

  if (dailyViews <= 0) {
    return {
      impressionsPerIteration,
      recommendedPerDay,
      iterationsPerDay: null,
      feasible: null,
      text: `Одна итерация теста — ${impressionsPerIteration.toLocaleString("ru-RU")} показов (с запасом ~15% — ${recommendedPerDay.toLocaleString("ru-RU")}). Средний суточный трафик привязанной кампании пока неизвестен — сколько итераций влезет в день, оцените по общему трафику товара выше.`,
      };
  }

  const iterationsPerDay = dailyViews / impressionsPerIteration;
  const feasible = dailyViews >= impressionsPerIteration;
  const roundedDaily = Math.round(dailyViews).toLocaleString("ru-RU");
  const text = feasible
    ? `Кампания даёт в среднем ${roundedDaily} показов/сутки — хватает на ${iterationsPerDay.toFixed(1)} итераций теста в день (одна — ${impressionsPerIteration.toLocaleString("ru-RU")} показов, с запасом ~15% — ${recommendedPerDay.toLocaleString("ru-RU")}).`
    : `Кампания даёт в среднем ${roundedDaily} показов/сутки — не хватает даже на одну итерацию в день (нужно ${impressionsPerIteration.toLocaleString("ru-RU")}, с запасом ~15% — ${recommendedPerDay.toLocaleString("ru-RU")}). Рассмотрите повышение ставки или снижение цели.`;

  return { impressionsPerIteration, recommendedPerDay, iterationsPerDay, feasible, text };
}
