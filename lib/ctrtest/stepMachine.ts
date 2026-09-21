import type { CtrMetricSnapshot } from "./model";

/**
 * Решения конечного автомата шага — чистые функции, без сети и базы.
 *
 * Цепочка шага (владелец, 21.09.2026):
 *   swap → starting → warmup → collecting → settling → закрыт
 *   смена фото · запуск рекламы · 5 минут на прогрев · откручиваем до цели ·
 *   реклама на паузе, ждём, пока статистика устоится · запись в историю
 *
 * WB отдаёт агрегаты без деталей: показы варианта доезжают с задержкой и по
 * дороге приписываются соседнему шагу. Чтобы забрать цифру, близкую к правде,
 * рекламу после цели ставят на паузу и опрашивают статистику, пока она не
 * перестанет меняться. Пока кампания крутится, цифры растут всегда, поэтому
 * без паузы «устоявшейся» статистики не существует.
 */

export type StepPhase = "swap" | "starting" | "warmup" | "collecting" | "settling";

/** Показания счётчиков кампании в момент опроса. */
export interface StepReading {
  at: string;
  impressions: number;
  clicks: number;
  spend: number;
}

/** Всё, что движок записывает о шаге, кроме самих метрик: журнал для истории и разбора сбоев. */
export interface StepDetail {
  attempts?: number;
  /** Сколько раз подряд шаг споткнулся об один и тот же сбой. */
  failStreak?: number;
  lastError?: string | null;
  swappedAt?: string;
  campaignStartedAt?: string;
  warmupUntil?: string;
  collectStartedAt?: string;
  /** С какой даты (МСК) читаем статистику кампании: окно фиксировано на шаг, иначе дельта поплывёт. */
  rangeFrom?: string;
  stopSnapshot?: CtrMetricSnapshot;
  stopReason?: "target" | "timeout";
  stoppedAt?: string;
  reads?: StepReading[];
  finalSnapshot?: CtrMetricSnapshot;
  settledAt?: string;
  /** Последнее показание — из него экран считает «идёт сейчас», не дёргая WB. */
  lastRead?: StepReading;
}

export const toReading = (snapshot: CtrMetricSnapshot): StepReading => ({
  at: snapshot.capturedAt,
  impressions: snapshot.impressions,
  clicks: snapshot.clicks,
  spend: snapshot.spend,
});

/** Журнал опросов ограничен: длинное ожидание не должно раздувать строку шага. */
const MAX_READS = 40;
export const appendReading = (reads: StepReading[] | undefined, reading: StepReading): StepReading[] =>
  [...(reads ?? []), reading].slice(-MAX_READS);

const minutes = (from: string | undefined, now: number): number => {
  const start = from ? Date.parse(from) : NaN;
  return Number.isFinite(start) ? (now - start) / 60_000 : 0;
};

export type CollectDecision =
  | { stop: false; impressions: number }
  | { stop: true; reason: "target" | "timeout"; impressions: number };

/**
 * Пора ли останавливать показ варианта.
 *
 * Цель — показы с момента прогрева. Не набрали за максимальное время — стоп
 * с пометкой «timeout»: тест не должен крутить один вариант бесконечно, а
 * недобор виден в истории и в итоговом объяснении, а не спрятан.
 */
export function collectDecision(input: {
  baseline: Pick<CtrMetricSnapshot, "impressions">;
  live: Pick<CtrMetricSnapshot, "impressions">;
  target: number;
  collectStartedAt: string | undefined;
  now: number;
  maxStepMin: number;
}): CollectDecision {
  const impressions = Math.max(0, input.live.impressions - input.baseline.impressions);
  if (impressions >= input.target) return { stop: true, reason: "target", impressions };
  if (minutes(input.collectStartedAt, input.now) >= input.maxStepMin) return { stop: true, reason: "timeout", impressions };
  return { stop: false, impressions };
}

const sameReading = (a: StepReading, b: StepReading) => a.impressions === b.impressions && a.clicks === b.clicks && a.spend === b.spend;

/** Устоялась ли статистика: последние N показаний одинаковы. */
export function isStable(reads: StepReading[] | undefined, stableReads: number): boolean {
  const list = reads ?? [];
  if (stableReads < 2 || list.length < stableReads) return false;
  const tail = list.slice(-stableReads);
  return tail.every((reading) => sameReading(reading, tail[0]));
}

export type SettleDecision = { status: "stable" } | { status: "waiting" } | { status: "timeout" };

/**
 * Дождались ли устоявшейся статистики.
 *
 * Не дождались за отведённое время — это не «шаг закончен» и не «шаг пропущен»:
 * решение принимает человек (тест встаёт на паузу, шаг повторится при
 * возобновлении). Тихо взять то, что есть, значило бы записать в историю цифру,
 * которая ещё меняется, — ровно ту ошибку, ради которой ожидание и введено.
 */
export function settleDecision(input: {
  reads: StepReading[] | undefined;
  stableReads: number;
  stoppedAt: string | undefined;
  now: number;
  settleMaxMin: number;
}): SettleDecision {
  if (isStable(input.reads, input.stableReads)) return { status: "stable" };
  if (minutes(input.stoppedAt, input.now) >= input.settleMaxMin) return { status: "timeout" };
  return { status: "waiting" };
}

/** Шаг закончен ровно теми показаниями, что устоялись: последнее из журнала. */
export function readingToSnapshot(base: CtrMetricSnapshot, reading: StepReading): CtrMetricSnapshot {
  return { ...base, impressions: reading.impressions, clicks: reading.clicks, spend: reading.spend, capturedAt: reading.at };
}
