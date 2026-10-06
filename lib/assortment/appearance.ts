import { plural } from "@/lib/warehouse/plural";
import { modelKey } from "./modelKey";
import type { RunCoverage } from "./observationLog";
import { APPEARANCE_MIN_SPAN_DAYS, type HistoryStatus } from "./observationState";

/**
 * «Появилось / пропало» (движок тенденций, Ф3): что бренды добавили и что убрали за период — по снимкам ПОЛНЫХ прогонов обхода
 * (assortment_run + assortment_item_snapshot). Чистые функции: какие прогоны читать и что из них следует.
 *
 * Правила (одобрено владельцем 07.10; правило «пропало» — по рекомендации, пока владелец не скажет иное):
 *  - засчитываются только полные прогоны основного раздела; оборванный (partial) не засчитывается вовсе — его «нет» ничего не значит;
 *  - на один день — один прогон (последний): повтор обхода в тот же день не второе наблюдение;
 *  - «Появилось» — модель есть в последнем полном прогоне, а в DISAPPEAR_FULL_RUNS полных прогонах на начало периода её не было;
 *    история полных прогонов источника — не короче APPEARANCE_MIN_SPAN_DAYS дней (иначе «новым» оказалось бы всё);
 *  - «Пропало» — модели нет в DISAPPEAR_FULL_RUNS последних полных прогонах подряд, а до них (на начало периода) она была: один
 *    пропуск — не «пропало» (сайт мог временно снять карточку);
 *  - источники, которые видят только верх выдачи (ASOS с Mango, H&M, Lime, Zalando), и части разделов (Zara CHAQUETA, коллаборации
 *    Uniqlo) — отдельный список «впервые попало в верх выдачи»: «пропало» у них не бывает, выпасть из окна ≠ исчезнуть с сайта.
 *
 * Читаем не всю историю, а несколько прогонов на источник: последние DISAPPEAR_FULL_RUNS и столько же на начало периода.
 * Цен нет (граница модуля); «пропало» — наблюдение, а не причина (распродано, снято, раскуплено — по одному снимку не отличить).
 */

/** «Пропало» = модели нет в стольких полных прогонах подряд (в разные дни), а до них была. Одна константа — и правило, и подпись на экране. */
export const DISAPPEAR_FULL_RUNS = 2;

export const CHANGES_PERIODS = [7, 30] as const;
export type ChangesPeriod = (typeof CHANGES_PERIODS)[number];
export const DEFAULT_CHANGES_PERIOD: ChangesPeriod = 7;
/** Месячная выжимка воскресной сводки (первое воскресенье месяца). */
export const MONTH_PERIOD_DAYS: ChangesPeriod = 30;

/**
 * Массовая смена у источника: столько моделей разом (и не меньше этой доли прогона) появилось или пропало — похоже на смену
 * устройства сайта или фильтра выборки, а не на решения бренда. Модели не прячем, но ставим их в конец и называем это (оценка).
 */
export const MASS_CHANGE_MIN = 30;
export const MASS_CHANGE_SHARE = 0.3;

export function parseChangesPeriod(raw: string | null | undefined): ChangesPeriod {
  return raw === "30" ? 30 : DEFAULT_CHANGES_PERIOD;
}

const DAY_MS = 24 * 3600 * 1000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const laterOf = (a: string, b: string) => (a > b ? a : b);
/** «07.10» из «2026-10-07». */
export const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

export interface ChangeRun {
  runId: string;
  sourceId: string;
  /** Раздел прогона; null — источник обойдён целиком (Shopify), раздел несёт каждый снимок. */
  direction: string | null;
  observedOn: string;
  startedAt: string;
  coverage: RunCoverage;
  /** Часть раздела (Zara CHAQUETA, коллаборации Uniqlo) — отдельная выборка-окно; null — основной прогон. */
  part?: string | null;
}

/** Поток прогонов: основной раздел источника (полный или только верх выдачи) либо часть раздела. */
export type StreamKind = "full" | "window" | "part";
/** ready — можно утверждать; building — истории мало; stale — за период не было ни одного годного прогона. */
export type StreamStatus = "ready" | "building" | "stale";

export interface ChangeStream {
  sourceId: string;
  kind: StreamKind;
  part: string | null;
  /** Последний годный прогон потока (у «full» — последний полный). */
  latest: ChangeRun | null;
  /** DISAPPEAR_FULL_RUNS последних прогонов (разные дни), новые первыми: «нет в них» = пропало. */
  recent: ChangeRun[];
  /** До DISAPPEAR_FULL_RUNS прогонов на начало периода (не позже дня перед периодом), новые первыми. */
  base: ChangeRun[];
  /** Первый день потока (у «full» — первый полный прогон) и сколько дней с прогонами. */
  firstDay: string | null;
  days: number;
  status: StreamStatus;
  /** Когда поток станет честным — расчёт по текущим порогам (не обещание); null — уже честный или прогонов за период нет. */
  readyOn: string | null;
  /** «Пропало» можно утверждать: только у полного основного раздела, от DISAPPEAR_FULL_RUNS + 1 полных прогонов. */
  disappearReady: boolean;
  /** Сколько ещё полных прогонов (в разные дни) нужно до «пропало». */
  disappearRunsMissing: number;
  /** У части раздела: прогоны основного раздела — их модели не «впервые в верху выдачи» (они уже в полном прогоне). */
  exclude: ChangeRun[];
}

export interface ChangesPlan {
  today: string;
  periodDays: number;
  /** Последний день ДО периода: прогоны не позже него — «на начало периода». */
  periodStart: string;
  streams: ChangeStream[];
}

/** По одному прогону на день — последний по началу: повтор обхода в тот же день не второе независимое наблюдение. Новые первыми. */
function perDay(runs: ChangeRun[]): ChangeRun[] {
  const byDay = new Map<string, ChangeRun>();
  for (const run of runs) {
    const current = byDay.get(run.observedOn);
    if (!current || run.startedAt > current.startedAt) byDay.set(run.observedOn, run);
  }
  return [...byDay.values()].sort((a, b) => b.observedOn.localeCompare(a.observedOn));
}

function buildStream(sourceId: string, kind: StreamKind, part: string | null, runs: ChangeRun[], today: string, periodStart: string, exclude: ChangeRun[] = []): ChangeStream {
  const list = perDay(runs);
  const latest = list[0] ?? null;
  const older = list.slice(1);
  const firstDay = list.length ? list[list.length - 1].observedOn : null;
  const before = older.filter((r) => r.observedOn <= periodStart);
  // На начало периода прогонов нет (период длиннее истории — месячная выжимка в первый месяц): база — самые ранние прогоны, и
  // на экране это видно по датам. Для недели так не бывает: тогда и истории меньше 7 дней, поток копится.
  const base = before.length ? before.slice(0, DISAPPEAR_FULL_RUNS) : older.slice(-DISAPPEAR_FULL_RUNS);
  const recent = list.slice(0, DISAPPEAR_FULL_RUNS);
  let status: StreamStatus = "ready";
  let readyOn: string | null = null;
  if (!latest || latest.observedOn <= periodStart) status = "stale";
  else if (!firstDay || daysBetween(firstDay, latest.observedOn) < APPEARANCE_MIN_SPAN_DAYS || base.length === 0) {
    status = "building";
    readyOn = firstDay ? laterOf(addDays(firstDay, APPEARANCE_MIN_SPAN_DAYS), today) : null;
  }
  const recentIds = new Set(recent.map((r) => r.runId));
  const disappearRunsMissing = kind === "full" ? Math.max(0, DISAPPEAR_FULL_RUNS + 1 - list.length) : 0;
  const disappearReady = kind === "full" && status === "ready" && disappearRunsMissing === 0 && base.some((r) => !recentIds.has(r.runId));
  return { sourceId, kind, part, latest, recent, base, firstDay, days: list.length, status, readyOn, disappearReady, disappearRunsMissing, exclude };
}

/**
 * Какие потоки есть у источников и что по каждому можно утверждать за период (today − periodDays, today]. Прогоны — уже отобранные
 * для раздела (свои и «целиком»). Источник с хотя бы одним полным прогоном — полный (окна у него не засчитываются); без полных —
 * «только верх выдачи». Части разделов — свои потоки.
 */
export function planChanges(runs: ChangeRun[], today: string, periodDays: number): ChangesPlan {
  const periodStart = addDays(today, -periodDays);
  const bySource = new Map<string, ChangeRun[]>();
  for (const run of runs) {
    // Оборванный прогон не засчитывается вовсе: ни как «есть», ни как «нет».
    if (run.coverage === "partial") continue;
    bySource.set(run.sourceId, [...(bySource.get(run.sourceId) ?? []), run]);
  }
  const streams: ChangeStream[] = [];
  for (const [sourceId, list] of [...bySource.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const main = list.filter((r) => !r.part);
    const full = main.filter((r) => r.coverage === "full");
    const mainStream = full.length ? buildStream(sourceId, "full", null, full, today, periodStart) : main.length ? buildStream(sourceId, "window", null, main, today, periodStart) : null;
    if (mainStream) streams.push(mainStream);
    const exclude = mainStream ? uniqueRuns([mainStream.latest, ...mainStream.base]) : [];
    for (const part of [...new Set(list.filter((r) => r.part).map((r) => String(r.part)))].sort()) {
      streams.push(buildStream(sourceId, "part", part, list.filter((r) => r.part === part), today, periodStart, exclude));
    }
  }
  return { today, periodDays, periodStart, streams };
}

function uniqueRuns(runs: Array<ChangeRun | null | undefined>): ChangeRun[] {
  const seen = new Map<string, ChangeRun>();
  for (const run of runs) if (run && !seen.has(run.runId)) seen.set(run.runId, run);
  return [...seen.values()];
}

/** Прогоны, снимки которых нужно прочитать: только у готовых потоков — последние, на начало периода и (у частей) основного раздела. */
export function runsToRead(plan: ChangesPlan): ChangeRun[] {
  return uniqueRuns(plan.streams.filter((s) => s.status === "ready").flatMap((s) => [s.latest, ...s.recent, ...s.base, ...s.exclude]));
}

export interface SnapshotLite {
  sourceItemId: string;
  title: string | null;
  brand?: string | null;
}

export type ChangeKind = "appeared" | "disappeared" | "first_window";

export interface ChangeItem {
  kind: ChangeKind;
  sourceId: string;
  part: string | null;
  modelKey: string;
  /** Строка каталога, которой модель представлена (для «Отобрать» и «Не интересно» — они действуют на всю модель). */
  itemId: string;
  title: string | null;
  brand: string | null;
  /** Прогон, в котором модель есть (у «пропало» — последний, где была). */
  seenOn: string;
  /** Прогоны, в которых её нет (у «появилось» — на начало периода, у «пропало» — последние). */
  absentOn: string[];
  /** У источника массовая смена (оценка): модели в конце списка. */
  mass: boolean;
}

export interface StreamSummary {
  sourceId: string;
  kind: StreamKind;
  part: string | null;
  /** gap — в одном из нужных прогонов нет ни одной модели раздела, когда в соседнем есть: сравнение было бы ложным. */
  status: StreamStatus | "gap";
  readyOn: string | null;
  disappearReady: boolean;
  disappearRunsMissing: number;
  latestOn: string | null;
  baseOn: string[];
  recentOn: string[];
  appeared: number;
  disappeared: number;
  firstInWindow: number;
  /** Моделей в последнем прогоне (раздел); null — снимки не читались (поток не готов). */
  models: number | null;
  mass: boolean;
}

export interface ChangesComputed {
  items: ChangeItem[];
  streams: StreamSummary[];
}

/** Модели прогона: ключ модели → первая строка (расцветки одной модели Shopify и ASOS — одна модель). */
function modelsOf(sourceId: string, rows: readonly SnapshotLite[] | undefined): Map<string, SnapshotLite> {
  const map = new Map<string, SnapshotLite>();
  for (const row of rows ?? []) {
    const key = modelKey({ sourceId, sourceItemId: row.sourceItemId, title: row.title });
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

const isMass = (count: number, of: number) => count >= MASS_CHANGE_MIN && count > of * MASS_CHANGE_SHARE;

/**
 * Что появилось, пропало и впервые попало в верх выдачи — по снимкам прочитанных прогонов (runId → строки раздела). Поток, у
 * которого в одном из нужных прогонов нет ни одной модели раздела (а в соседнем есть), не сравнивается: «пропало всё» или
 * «появилось всё» было бы ложью сборщика, а не решением бренда.
 */
export function computeChanges(plan: ChangesPlan, snapshots: ReadonlyMap<string, readonly SnapshotLite[]>): ChangesComputed {
  const items: ChangeItem[] = [];
  const streams: StreamSummary[] = [];
  for (const stream of plan.streams) {
    const summary: StreamSummary = {
      sourceId: stream.sourceId, kind: stream.kind, part: stream.part, status: stream.status, readyOn: stream.readyOn,
      disappearReady: stream.disappearReady, disappearRunsMissing: stream.disappearRunsMissing,
      latestOn: stream.latest?.observedOn ?? null, baseOn: stream.base.map((r) => r.observedOn), recentOn: stream.recent.map((r) => r.observedOn),
      appeared: 0, disappeared: 0, firstInWindow: 0, models: null, mass: false,
    };
    streams.push(summary);
    if (stream.status !== "ready" || !stream.latest) continue;
    const models = new Map<string, Map<string, SnapshotLite>>();
    const of = (run: ChangeRun) => {
      let map = models.get(run.runId);
      if (!map) {
        map = modelsOf(stream.sourceId, snapshots.get(run.runId));
        models.set(run.runId, map);
      }
      return map;
    };
    const own = uniqueRuns([stream.latest, ...stream.recent, ...stream.base]);
    const sizes = own.map((r) => of(r).size);
    if (sizes.every((n) => n === 0)) {
      // В разделе у источника моделей нет вовсе (обход «целиком» без этого раздела): нечего сравнивать — и показывать нечего.
      summary.models = 0;
      continue;
    }
    if (sizes.some((n) => n === 0)) {
      summary.status = "gap";
      continue;
    }
    const latest = of(stream.latest);
    summary.models = latest.size;
    const inAny = (runs: ChangeRun[], key: string) => runs.some((r) => of(r).has(key));
    const found: ChangeItem[] = [];
    if (stream.kind === "full") {
      for (const [key, row] of latest) {
        if (inAny(stream.base, key)) continue;
        found.push(item("appeared", stream, key, row, stream.latest.observedOn, stream.base.map((r) => r.observedOn)));
      }
      if (stream.disappearReady) {
        const recentIds = new Set(stream.recent.map((r) => r.runId));
        const earlier = stream.base.filter((r) => !recentIds.has(r.runId));
        const seen = new Set<string>();
        for (const run of earlier) {
          for (const [key, row] of of(run)) {
            if (seen.has(key)) continue;
            seen.add(key);
            if (inAny(stream.recent, key)) continue;
            found.push(item("disappeared", stream, key, row, run.observedOn, stream.recent.map((r) => r.observedOn)));
          }
        }
      }
    } else {
      for (const [key, row] of latest) {
        if (inAny(stream.base, key) || inAny(stream.exclude, key)) continue;
        found.push(item("first_window", stream, key, row, stream.latest.observedOn, stream.base.map((r) => r.observedOn)));
      }
    }
    summary.appeared = found.filter((i) => i.kind === "appeared").length;
    summary.disappeared = found.filter((i) => i.kind === "disappeared").length;
    summary.firstInWindow = found.filter((i) => i.kind === "first_window").length;
    const baseSize = Math.max(0, ...stream.base.map((r) => of(r).size));
    summary.mass = isMass(summary.appeared + summary.firstInWindow, latest.size) || isMass(summary.disappeared, baseSize);
    for (const f of found) items.push({ ...f, mass: summary.mass });
  }
  return { items, streams };
}

function item(kind: ChangeKind, stream: ChangeStream, key: string, row: SnapshotLite, seenOn: string, absentOn: string[]): ChangeItem {
  return { kind, sourceId: stream.sourceId, part: stream.part, modelKey: key, itemId: row.sourceItemId, title: row.title, brand: row.brand ?? null, seenOn, absentOn, mass: false };
}

/** Вкладка «Изменения»: есть, когда хотя бы у одного полного источника «появилось/пропало» уже наблюдение — и после 28 дней (динамика) не пропадает. */
export function changesTabVisible(sources: ReadonlyArray<{ status: HistoryStatus }>): boolean {
  return sources.some((s) => s.status === "appearance" || s.status === "dynamics");
}

/**
 * Подпись к «пропало» в декабре–феврале: идут распродажи, и пропажа модели чаще значит «распродано или раскуплено», а не «бренд
 * отказался». Правило, которое это различает, — позже (Ф9); здесь только честная подпись. null — не сезон.
 */
export function seasonCaption(today: string): string | null {
  const month = Number(today.slice(5, 7));
  if (!(month === 12 || month <= 2)) return null;
  return "В январе–феврале «пропало» = «распродано или раскуплено»: идут распродажи, и пропажа модели не значит, что бренд от неё отказался (правило, которое это различает, — позже).";
}

/** Первое воскресенье месяца — в сводку добавляется выжимка «за месяц». */
export function isFirstSundayOfMonth(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return date.getUTCDay() === 0 && date.getUTCDate() <= 7;
}

/** Правило «пропало» словами — одно на экран, сводку и полоску. */
export const DISAPPEAR_RULE_TEXT = `«Пропало» — модели нет в ${DISAPPEAR_FULL_RUNS} полных прогонах подряд (в разные дни), а до них была; один пропуск — не «пропало».`;

export interface ChangesReadinessSource {
  name: string;
  status: HistoryStatus;
  /** Дней с полными прогонами (основной раздел). */
  fullDays?: number;
  firstDay: string | null;
  firstFullDay: string | null;
}

export interface ChangesReadinessLine {
  kind: "факт" | "оценка";
  text: string;
}

/**
 * Строки полоски «На чём стоят цифры» про вкладку «Изменения»: по каким источникам «появилось» и «пропало» уже честные, по каким пока
 * только «появилось» (для «пропало» нужен ещё полный прогон) и по каким копится — с датой готовности (расчёт по текущим порогам).
 * stuck — источники, у которых второй полный прогон не приходит (их дата «не раньше сегодня» ничего бы не значила).
 */
export function changesReadiness(sources: readonly ChangesReadinessSource[], today: string, stuck: ReadonlySet<string> = new Set()): ChangesReadinessLine[] {
  const lines: ChangesReadinessLine[] = [];
  const honest = sources.filter((s) => s.status === "appearance" || s.status === "dynamics");
  const both = honest.filter((s) => (s.fullDays ?? 0) >= DISAPPEAR_FULL_RUNS + 1).map((s) => s.name);
  if (both.length) lines.push({ kind: "факт", text: `Вкладка «Изменения»: «появилось» и «пропало» честные — ${both.join(", ")}.` });
  const onlyAppeared = honest.filter((s) => (s.fullDays ?? 0) < DISAPPEAR_FULL_RUNS + 1).map((s) => {
    const missing = DISAPPEAR_FULL_RUNS + 1 - (s.fullDays ?? 0);
    return `${s.name} — после ещё ${missing} ${plural(missing, "полного прогона", "полных прогонов", "полных прогонов")}`;
  });
  if (onlyAppeared.length) {
    lines.push({ kind: "факт", text: `Вкладка «Изменения»: пока только «появилось», «пропало» (${DISAPPEAR_FULL_RUNS} полных прогона подряд без модели): ${onlyAppeared.join("; ")}.` });
  }
  const building = sources.filter((s) => s.status === "building" || s.status === "none").map((s) => {
    if (stuck.has(s.name)) return `${s.name} — второй полный прогон не приходит`;
    return s.firstFullDay ? `${s.name} — не раньше ${dm(laterOf(addDays(s.firstFullDay, APPEARANCE_MIN_SPAN_DAYS), today))}` : `${s.name} — ждёт первого полного прогона`;
  });
  if (building.length) lines.push({ kind: "оценка", text: `Вкладка «Изменения» копится: ${building.join("; ")}.` });
  const windowOnly = sources.filter((s) => s.status === "window_only").map((s) => {
    const ready = s.firstDay ? addDays(s.firstDay, APPEARANCE_MIN_SPAN_DAYS) : null;
    return ready && ready > today ? `${s.name} — с ${dm(ready)}` : s.name;
  });
  if (windowOnly.length) lines.push({ kind: "факт", text: `Только верх выдачи — в «Изменениях» список «впервые в верху выдачи», «пропало» у них не бывает: ${windowOnly.join("; ")}.` });
  return lines;
}
