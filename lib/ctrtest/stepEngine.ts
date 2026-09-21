import { ctrSnapshotDelta, type CtrMetricSnapshot } from "./model";
import { isLiveWbCoverUrl } from "./pinImage";
import {
  appendReading,
  collectDecision,
  readingToSnapshot,
  settleDecision,
  toReading,
  type StepDetail,
  type StepPhase,
} from "./stepMachine";
import { MAX_FAIL_STREAK, planStep } from "./stepPlan";

/**
 * Движок шага CTR-теста: один проход крона двигает шаг на одну-две фазы.
 *
 *   swap → starting → warmup → collecting → settling → закрыт → следующий шаг
 *
 * Правило, ради которого всё устроено (владелец, 21.09.2026): сбой на любом
 * этапе — упал API, фото не сменилось, реклама не запустилась, статистика не
 * устоялась — НЕ завершает шаг и НЕ пропускает его. Шаг остаётся на своей фазе и
 * повторяется на следующем проходе. Только повтор одного и того же сбоя
 * несколько проходов подряд или неустоявшаяся статистика ставят тест на паузу:
 * дальше решает человек, а шаг при возобновлении начнётся заново.
 *
 * Модуль ничего не знает про Supabase и WB: всё внешнее приходит через `StepIo`
 * и `StepStore`, поэтому каждую ветку можно проверить тестом.
 */

export interface EngineTest {
  id: number;
  cabinet_id: string;
  nm_id: number;
  advert_id: number | null;
  /** Целевые показы на шаг. Колонка называется по-старому: раньше это была «норма раунда». */
  impressions_per_round: number;
  dead_zone_min: number;
  max_step_min: number;
  settle_max_min: number;
  settle_stable_reads: number;
  /** По раундам, id вариантов. */
  variant_orders: number[][] | null;
}

export interface EngineStep {
  id: string;
  variant_id: number;
  pass_no: number | null;
  phase: StepPhase | null;
  baseline: Partial<CtrMetricSnapshot> | null;
  detail: StepDetail | null;
}

export type IoResult = { ok: true } | { ok: false; error: string };
export type LiveRead = { ok: true; snapshot: CtrMetricSnapshot } | { ok: false; error: string; rateLimited?: boolean };

export interface StepIo {
  now(): number;
  /** Сегодняшняя дата по Москве, ГГГГ-ММ-ДД. */
  todayMsk(): string;
  shiftDay(iso: string, days: number): string;
  liveSnapshot(test: EngineTest, from: string, to: string): Promise<LiveRead>;
  swapPhoto(test: EngineTest, imageUrl: string): Promise<IoResult>;
  startCampaign(test: EngineTest): Promise<IoResult>;
  pauseCampaign(test: EngineTest): Promise<IoResult>;
}

export interface StepPatch {
  phase?: StepPhase;
  phase_at?: string;
  pass_no?: number;
  baseline?: CtrMetricSnapshot;
  detail?: StepDetail;
}

export interface StepStore {
  variantUrls(testId: number): Promise<Map<number, string>>;
  /** Сколько шагов уже закрыто: по нему определяется место в плане. */
  closedSteps(testId: number): Promise<number>;
  patchStep(stepId: string, patch: StepPatch): Promise<void>;
  /** Закрыть идущий шаг и, если план не выполнен, открыть следующий. Бросает при отказе базы. */
  closeStep(input: {
    testId: number;
    action: "advance" | "finish";
    variantId: number | null;
    snapshot: CtrMetricSnapshot;
    result: ReturnType<typeof ctrSnapshotDelta>;
  }): Promise<{ status: string }>;
  /** Только что открытый шаг получает номер раунда и начальную фазу. */
  labelOpenedStep(testId: number, patch: { phase: StepPhase; phase_at: string; pass_no: number; detail: StepDetail }): Promise<void>;
  pauseTest(testId: number, reason: string): Promise<void>;
}

export interface TickResult {
  /** Короткая строка для отчёта крона. */
  note: string;
  detail?: string;
  /** Сбой этого прохода: пишется в `ctr_tests.auto_error`. null — проход чистый. */
  error: string | null;
  /** Статус теста после прохода, если он изменился: по нему вызывающий возвращает витрину и кампанию. */
  testStatus?: "paused" | "done" | "cancelled";
}

const iso = (ms: number) => new Date(ms).toISOString();
const minutesLeft = (untilMs: number, now: number) => Math.max(1, Math.ceil((untilMs - now) / 60_000));

export const LIVE_URL_ERROR = "вариант ссылается на живую обложку WB, а не на сохранённую копию (тест создан до исправления) — создайте тест заново";

/**
 * Один проход по идущему шагу. Цикл нужен, чтобы фазы, не требующие ожидания
 * (смена фото → запуск рекламы), шли подряд за один проход, а не по пять минут
 * на каждую.
 */
export async function runStepTick(test: EngineTest, step: EngineStep, io: StepIo, store: StepStore): Promise<TickResult> {
  let phase: StepPhase = step.phase ?? "swap";
  let detail: StepDetail = { ...(step.detail ?? {}) };
  const done: string[] = [];

  const patch = async (next: { phase?: StepPhase; baseline?: CtrMetricSnapshot; detail?: StepDetail }) => {
    if (next.phase) phase = next.phase;
    if (next.detail) detail = next.detail;
    await store.patchStep(step.id, {
      ...(next.phase ? { phase: next.phase, phase_at: iso(io.now()) } : {}),
      ...(next.baseline ? { baseline: next.baseline } : {}),
      detail,
    });
  };

  /** Сбой: шаг остаётся на своей фазе. Чистый счётчик — после первого же удачного действия. */
  const fail = async (message: string, fatal = false): Promise<TickResult> => {
    const streak = (detail.failStreak ?? 0) + 1;
    detail = { ...detail, lastError: message, failStreak: streak, attempts: (detail.attempts ?? 0) + 1 };
    await store.patchStep(step.id, { detail });
    if (fatal || streak >= MAX_FAIL_STREAK) {
      const reason = fatal ? message : `${message} (${streak} прохода подряд)`;
      await store.pauseTest(test.id, reason);
      return { note: "тест на паузе", detail: reason, error: reason, testStatus: "paused" };
    }
    return { note: `сбой на фазе «${phase}», повтор на следующем проходе`, detail: message, error: message };
  };
  const clean = (): StepDetail => ({ ...detail, failStreak: 0, lastError: null });

  if (test.advert_id == null) return fail("у теста нет привязанной кампании — новый движок без неё не работает", true);

  for (let guard = 0; guard < 4; guard++) {
    const now = io.now();

    if (phase === "swap") {
      const url = (await store.variantUrls(test.id)).get(step.variant_id);
      if (!url) return fail("у шага нет картинки варианта", true);
      if (isLiveWbCoverUrl(url)) return fail(LIVE_URL_ERROR, true);
      const swapped = await io.swapPhoto(test, url);
      if (!swapped.ok) return fail(`фото не сменилось: ${swapped.error}`);
      await patch({ phase: "starting", detail: { ...clean(), swappedAt: iso(now) } });
      done.push("фото сменено");
      continue;
    }

    if (phase === "starting") {
      const started = await io.startCampaign(test);
      if (!started.ok) return fail(`реклама не запустилась: ${started.error}`);
      const warmupUntil = now + Math.max(0, test.dead_zone_min) * 60_000;
      await patch({ phase: "warmup", detail: { ...clean(), campaignStartedAt: iso(now), warmupUntil: iso(warmupUntil) } });
      done.push("реклама запущена");
      continue;
    }

    if (phase === "warmup") {
      const until = Date.parse(detail.warmupUntil ?? "");
      if (Number.isFinite(until) && now < until) {
        return { note: [...done, `прогрев: ещё ${minutesLeft(until, now)} мин`].join(", "), error: null };
      }
      // Начало замера — ПОСЛЕ прогрева: клики по прежней картинке ещё идут, и
      // считать их новому варианту нельзя.
      const from = io.shiftDay(io.todayMsk(), -1);
      const live = await io.liveSnapshot(test, from, io.todayMsk());
      if (!live.ok) return live.rateLimited ? { note: [...done, "лимит WB, опрос отложен"].join(", "), error: null } : fail(`статистика недоступна: ${live.error}`);
      await patch({
        phase: "collecting",
        baseline: live.snapshot,
        detail: { ...clean(), collectStartedAt: iso(now), rangeFrom: from, lastRead: toReading(live.snapshot) },
      });
      return { note: [...done, "прогрев окончен, набираем показы"].join(", "), error: null };
    }

    if (phase === "collecting") {
      const live = await io.liveSnapshot(test, detail.rangeFrom ?? io.shiftDay(io.todayMsk(), -1), io.todayMsk());
      if (!live.ok) return live.rateLimited ? { note: "лимит WB, опрос отложен", error: null } : fail(`статистика недоступна: ${live.error}`);
      const decision = collectDecision({
        baseline: { impressions: Number(step.baseline?.impressions ?? 0) },
        live: live.snapshot,
        target: test.impressions_per_round,
        collectStartedAt: detail.collectStartedAt,
        now,
        maxStepMin: test.max_step_min,
      });
      if (!decision.stop) {
        await patch({ detail: { ...clean(), lastRead: toReading(live.snapshot) } });
        return { note: `набрано ${decision.impressions} из ${test.impressions_per_round}`, error: null };
      }
      const paused = await io.pauseCampaign(test);
      if (!paused.ok) return fail(`реклама не остановилась: ${paused.error}`);
      await patch({
        phase: "settling",
        detail: {
          ...clean(),
          stopSnapshot: live.snapshot,
          stopReason: decision.reason,
          stoppedAt: iso(now),
          // Журнал опросов начинается ПУСТЫМ: показание со стопа снято до того,
          // как пауза дошла до WB, и первые опросы после неё ещё могут отдавать
          // прежние цифры. Устоявшейся считается статистика, которую подтвердили
          // N опросов ПОСЛЕ паузы, — минимум N×5 минут ожидания.
          reads: [],
          lastRead: toReading(live.snapshot),
        },
      });
      return {
        note: decision.reason === "target" ? "цель набрана, реклама на паузе" : "время шага вышло, реклама на паузе",
        detail: `${decision.impressions} из ${test.impressions_per_round}`,
        error: null,
      };
    }

    // settling
    const live = await io.liveSnapshot(test, detail.rangeFrom ?? io.shiftDay(io.todayMsk(), -1), io.todayMsk());
    if (!live.ok) return live.rateLimited ? { note: "лимит WB, опрос отложен", error: null } : fail(`статистика недоступна: ${live.error}`);
    const reading = toReading(live.snapshot);
    const reads = appendReading(detail.reads, reading);
    const verdict = settleDecision({ reads, stableReads: test.settle_stable_reads, stoppedAt: detail.stoppedAt, now, settleMaxMin: test.settle_max_min });

    if (verdict.status === "waiting") {
      await patch({ detail: { ...clean(), reads, lastRead: reading } });
      return { note: `ждём устоявшуюся статистику (${reads.length} опросов)`, error: null };
    }
    if (verdict.status === "timeout") {
      await patch({ detail: { ...detail, reads, lastRead: reading } });
      const reason = `статистика не устоялась за ${test.settle_max_min} мин: шаг не засчитан, при возобновлении он повторится`;
      await store.pauseTest(test.id, reason);
      return { note: "тест на паузе", detail: reason, error: reason, testStatus: "paused" };
    }

    // Устоялась: шаг заканчивается последним показанием, а не тем, что было на стопе.
    const final = readingToSnapshot(live.snapshot, reading);
    const baseline = (step.baseline ?? {}) as Partial<CtrMetricSnapshot>;
    const result = ctrSnapshotDelta(baseline, final);
    await patch({ detail: { ...clean(), reads, lastRead: reading, finalSnapshot: final, settledAt: iso(now) } });

    let next: ReturnType<typeof planStep> = null;
    try {
      const closed = await store.closedSteps(test.id);
      next = test.variant_orders ? planStep(test.variant_orders, closed + 1) : null;
      const outcome = await store.closeStep({
        testId: test.id,
        action: next ? "advance" : "finish",
        variantId: next?.variantId ?? null,
        snapshot: final,
        result,
      });
      if (next && outcome.status === "running") {
        await store.labelOpenedStep(test.id, { phase: "swap", phase_at: iso(now), pass_no: next.passNo, detail: {} });
        return { note: `шаг закрыт, дальше раунд ${next.passNo}`, detail: `+${result.impressions} показов, ${result.clicks} кликов`, error: null };
      }
      if (outcome.status === "done") return { note: "план выполнен, тест завершён", error: null, testStatus: "done" };
      if (outcome.status === "cancelled") return { note: "тест отменён", error: null, testStatus: "cancelled" };
      if (outcome.status === "paused") return { note: "потолок расхода — тест на паузе", error: null, testStatus: "paused" };
      return { note: "шаг закрыт", error: null };
    } catch (cause) {
      // База отказала при закрытии: шаг остаётся «устоявшимся» и закроется на
      // следующем проходе — данные при этом не потеряны, лежат в строке шага.
      return fail(`шаг не записан в историю: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { note: done.join(", ") || "без изменений", error: null };
}

/**
 * Результат шага, который человек закрывает досрочно (стоп, победитель, отмена),
 * — по последнему показанию самого шага, а не по снимку из базы: у базы другая
 * шкала (все дни), и разность с началом шага дала бы цифры чужих недель.
 */
export function partialStepResult(step: EngineStep): ReturnType<typeof ctrSnapshotDelta> {
  const baseline = (step.baseline ?? {}) as Partial<CtrMetricSnapshot>;
  const detail = step.detail ?? {};
  const reading = step.phase === "collecting" || step.phase === "settling" ? (detail.reads?.at(-1) ?? detail.lastRead) : undefined;
  if (!reading) return ctrSnapshotDelta({}, {});
  return ctrSnapshotDelta(baseline, readingToSnapshot(baseline as CtrMetricSnapshot, reading));
}
