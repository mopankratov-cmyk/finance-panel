import { CTR_MIN_VIEWS } from "@/lib/wb/ctrQuality";

/**
 * История шагов нового движка и сравнение CTR по раундам.
 *
 * Раунд — полный проход по всем вариантам, шаг — показ одного варианта внутри
 * него (владелец, 21.09.2026). Три замера шага: при СТАРТЕ (после прогрева),
 * при СТОПЕ (цель набрана, реклама на паузе) и ПОСЛЕ СТАБИЛИЗАЦИИ (статистика
 * перестала меняться). Разница между стопом и стабилизацией — это показы и клики,
 * которые WB доносил с задержкой: именно её и не видел прежний движок.
 *
 * Чистые функции без Supabase и React — чтобы каждое число на экране проверялось
 * тестом, а не глазами.
 */

export interface HistoryRound {
  id: string;
  variant_id: number;
  round_number: number;
  status: string;
  pass_no?: number | null;
  phase?: string | null;
  baseline?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
}

export interface HistoryVariant { id: number; label: string; position: number }

export interface HistoryInput {
  rounds: HistoryRound[];
  variants: HistoryVariant[];
  /** Порядок вариантов по раундам: id вариантов. */
  variantOrders?: number[][] | null;
  roundsTotal?: number | null;
  /** Целевые показы на шаг: по ним шаг помечается недобором. */
  impressionsPerStep: number;
}

export interface Counters { impressions: number; clicks: number }
export interface Result extends Counters { ctr: number | null }

export interface StepRow {
  id: string;
  passNo: number | null;
  variantId: number;
  letter: string;
  label: string;
  status: "active" | "closed";
  phase: string | null;
  /** Счётчики кампании при старте замера (после прогрева). */
  start: Counters | null;
  /** Счётчики на стопе: цель набрана, реклама поставлена на паузу. */
  stop: Counters | null;
  /** Счётчики после стабилизации. Идущему шагу — последний опрос, `finalProvisional`. */
  final: Counters | null;
  finalProvisional: boolean;
  /** Итог шага: после стабилизации минус старт. */
  result: Result | null;
  resultProvisional: boolean;
  /** Что WB донёс с задержкой: после стабилизации минус стоп. */
  lagged: Counters | null;
  stopReason: "target" | "timeout" | null;
  attempts: number;
  lastError: string | null;
  /** Шаг закрыт, а целевых показов не набрал — вышло время. */
  short: boolean;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asCounters = (value: unknown): Counters | null =>
  value && typeof value === "object" ? { impressions: num((value as Record<string, unknown>).impressions), clicks: num((value as Record<string, unknown>).clicks) } : null;

/** CTR в процентах; ниже порога знаменателя процент не рисуется — на десятке показов он скачет на десятки процентов. */
export const ctrOf = (impressions: number, clicks: number): number | null =>
  impressions >= CTR_MIN_VIEWS ? (clicks / impressions) * 100 : null;

const minus = (a: Counters, b: Counters): Counters => ({
  impressions: Math.max(0, a.impressions - b.impressions),
  clicks: Math.max(0, a.clicks - b.clicks),
});

const withCtr = (counters: Counters): Result => ({ ...counters, ctr: ctrOf(counters.impressions, counters.clicks) });

export const variantLetter = (position: number): string => String.fromCharCode(65 + Math.max(0, position));

/** Строки истории по порядку выполнения. Отменённые шаги в историю не входят. */
export function buildStepHistory(input: HistoryInput): StepRow[] {
  const variants = new Map(input.variants.map((variant) => [variant.id, variant]));
  return [...input.rounds]
    .filter((round) => round.status === "active" || round.status === "closed")
    .sort((a, b) => a.round_number - b.round_number)
    .map((round): StepRow => {
      const variant = variants.get(round.variant_id);
      const detail = (round.detail ?? {}) as Record<string, unknown>;
      const status = round.status === "closed" ? "closed" : "active";
      // До начала замера (смена фото, запуск рекламы, прогрев) baseline ещё
      // прежний или пустой — показывать его как «старт» значило бы выдать чужие цифры.
      const measuring = status === "closed" || round.phase === "collecting" || round.phase === "settling";
      const start = measuring ? asCounters(round.baseline) : null;
      const stop = asCounters(detail.stopSnapshot);
      const lastRead = asCounters(detail.lastRead);
      const settledFinal = asCounters(detail.finalSnapshot);
      const final = settledFinal ?? (status === "active" && round.phase === "settling" ? lastRead : null);
      const finalProvisional = settledFinal == null && final != null;

      let result: Result | null = null;
      let resultProvisional = false;
      if (status === "closed" && round.result) {
        result = withCtr({ impressions: num(round.result.impressions), clicks: num(round.result.clicks) });
      } else if (start && (final ?? (round.phase === "collecting" ? lastRead : null))) {
        result = withCtr(minus((final ?? lastRead) as Counters, start));
        resultProvisional = true;
      }

      const stopReason = detail.stopReason === "timeout" ? "timeout" : detail.stopReason === "target" ? "target" : null;
      return {
        id: round.id,
        passNo: round.pass_no ?? null,
        variantId: round.variant_id,
        letter: variantLetter(variant?.position ?? 0),
        label: variant?.label ?? String(round.variant_id),
        status,
        phase: round.phase ?? null,
        start,
        stop,
        final,
        finalProvisional,
        result,
        resultProvisional,
        lagged: stop && final ? minus(final, stop) : null,
        stopReason,
        attempts: num(detail.attempts),
        lastError: typeof detail.lastError === "string" && detail.lastError ? detail.lastError : null,
        short: status === "closed" && (stopReason === "timeout" || (result?.impressions ?? Infinity) < input.impressionsPerStep),
      };
    });
}

export interface MatrixCell extends Result { short: boolean }

export interface CtrMatrix {
  passes: { passNo: number; /** «A → B → C» */ order: string }[];
  rows: { variantId: number; letter: string; label: string; cells: (MatrixCell | null)[]; total: Result }[];
  /** Кто впереди в каждом раунде (id варианта), null — сравнивать нечем. */
  leaderByPass: (number | null)[];
  leaderTotal: number | null;
}

const leaderOf = (entries: { variantId: number; ctr: number | null }[]): number | null => {
  const scored = entries.filter((entry): entry is { variantId: number; ctr: number } => entry.ctr != null);
  // Один вариант с процентом — не лидер, а единственный; сравнение начинается с двух.
  if (scored.length < 2) return null;
  return scored.reduce((best, entry) => (entry.ctr > best.ctr ? entry : best)).variantId;
};

/**
 * CTR каждого варианта по раундам и итоговый. Итог считается ПО ИСТОРИИ — суммой
 * показов и кликов закрытых шагов, а не средним процентов: средние по раундам с
 * разным объёмом дали бы вес десятку показов наравне с тысячей.
 */
export function buildCtrMatrix(input: HistoryInput): CtrMatrix {
  const steps = buildStepHistory(input).filter((step) => step.status === "closed" && step.result);
  const declared = input.roundsTotal ?? 0;
  const seen = steps.reduce((max, step) => Math.max(max, step.passNo ?? 0), 0);
  const passCount = Math.max(declared, seen);
  const letters = new Map(input.variants.map((variant) => [variant.id, variantLetter(variant.position)]));

  const passes = Array.from({ length: passCount }, (_, index) => ({
    passNo: index + 1,
    order: (input.variantOrders?.[index] ?? []).map((id) => letters.get(id) ?? "?").join(" → "),
  }));

  const rows = [...input.variants].sort((a, b) => a.position - b.position).map((variant) => {
    const own = steps.filter((step) => step.variantId === variant.id);
    const cells: (MatrixCell | null)[] = Array.from({ length: passCount }, (_, index) => {
      const step = own.find((entry) => entry.passNo === index + 1);
      return step?.result ? { ...step.result, short: step.short } : null;
    });
    const impressions = own.reduce((sum, step) => sum + (step.result?.impressions ?? 0), 0);
    const clicks = own.reduce((sum, step) => sum + (step.result?.clicks ?? 0), 0);
    return { variantId: variant.id, letter: variantLetter(variant.position), label: variant.label, cells, total: withCtr({ impressions, clicks }) };
  });

  return {
    passes,
    rows,
    leaderByPass: passes.map((_, index) => leaderOf(rows.map((row) => ({ variantId: row.variantId, ctr: row.cells[index]?.ctr ?? null })))),
    leaderTotal: leaderOf(rows.map((row) => ({ variantId: row.variantId, ctr: row.total.ctr }))),
  };
}
