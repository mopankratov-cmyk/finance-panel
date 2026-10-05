import type { AssortmentDirection } from "./constants";
import { normalizeTitle, rulesFor } from "./forms";
import { growth, MIN_GROWTH_BASE, type KeywordRow } from "./wbDemand";
import { excludedReason, type ExcludedReason } from "./wbExclusions";

export { MIN_GROWTH_BASE };

/**
 * Спрос WB как собственная история (движок тенденций, этап 4). Чистые функции.
 *
 * Частотность запросов MPSTATS отдаёт ответом ~10 МБ за 30–90 секунд, поэтому
 * раз в неделю её снимает сборщик (assortment_wb_query_snapshot), а экран читает
 * готовое. Здесь — какие предметы смотрим, что оставляем от ответа, когда снимок
 * пора обновить и как запросы раскладываются по формам модели.
 *
 * Только частотность и число товаров по запросу — без цен и выручки (граница ТЗ).
 * wb_count у MPSTATS — снимок на конец окна, а не сумма за период, оценка для
 * направления, а не абсолютные числа.
 */

export interface WbSubject {
  id: number;
  name: string;
  direction: AssortmentDirection;
}

/**
 * Предметы WB по силуэтам (id сверены со списком предметов MPSTATS 04.10.2026).
 * Спрос на «бомбер» живёт в предмете «Бомберы», а не только в «Куртках», поэтому
 * смотрим не предметы своих карточек, а все силуэты раздела.
 */
export const WB_SUBJECTS: readonly WbSubject[] = [
  { id: 168, name: "Куртки", direction: "jackets" },
  { id: 172, name: "Ветровки", direction: "jackets" },
  { id: 174, name: "Пуховики", direction: "jackets" },
  { id: 1591, name: "Парки", direction: "jackets" },
  { id: 1635, name: "Бомберы", direction: "jackets" },
  { id: 171, name: "Плащи", direction: "jackets" },
  { id: 170, name: "Пальто", direction: "jackets" },
  { id: 1641, name: "Полупальто", direction: "jackets" },
  { id: 156, name: "Жилеты", direction: "jackets" },
  { id: 50, name: "Сумки", direction: "bags" },
  { id: 138, name: "Рюкзаки", direction: "bags" },
];

export function subjectsFor(direction: AssortmentDirection): WbSubject[] {
  return WB_SUBJECTS.filter((s) => s.direction === direction);
}

/** Сколько верхних (по частотности) запросов предмета оставляем от 5 000, что отдаёт MPSTATS. */
export const SNAPSHOT_KEEP = 2000;
/** Снимок предмета обновляем не чаще раза в неделю. */
export const SNAPSHOT_EVERY_DAYS = 7;
/** Окно запроса к MPSTATS, дней. */
export const WINDOW_DAYS = 30;
/** «Прошлый» срез для роста — снимок на ~30 дней раньше (допуск 20–45 дней). */
export const PREVIOUS_TARGET_GAP = 30;
export const PREVIOUS_MIN_GAP = 20;
export const PREVIOUS_MAX_GAP = 45;

/** [запрос, wb_count, items_count|null] — компактная запись, чтобы снимок был в десятки КБ. */
export type QueryTriple = [string, number, number | null];

const DAY_MS = 24 * 3600 * 1000;

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Разница в днях `to − from` между датами ГГГГ-ММ-ДД. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Верх списка по частотности; один запрос — одна строка (при дубле берём большую частотность). */
export function compactQueries(rows: KeywordRow[], keep = SNAPSHOT_KEEP): QueryTriple[] {
  const byWord = new Map<string, QueryTriple>();
  for (const row of rows) {
    const word = String(row.word ?? "").trim();
    const wb = Number(row.wb_count);
    if (!word || !Number.isFinite(wb) || wb <= 0) continue;
    const key = normalizeTitle(word);
    const prev = byWord.get(key);
    if (prev && prev[1] >= wb) continue;
    const items = row.items_count != null && Number.isFinite(Number(row.items_count)) ? Math.round(Number(row.items_count)) : null;
    byWord.set(key, [word.slice(0, 120), Math.round(wb), items]);
  }
  return [...byWord.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, keep);
}

/** Снимок из базы обратно в строки запросов; битые записи пропускаем, а не падаем. */
export function expandQueries(value: unknown): KeywordRow[] {
  if (!Array.isArray(value)) return [];
  const out: KeywordRow[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || typeof item[0] !== "string") continue;
    const wb = Number(item[1]);
    if (!Number.isFinite(wb)) continue;
    out.push({ word: item[0], wb_count: wb, items_count: item[2] == null ? undefined : Number(item[2]) });
  }
  return out;
}

export interface SnapshotMeta {
  subjectId: number;
  windowTo: string;
}

export interface SnapshotTask {
  subject: WbSubject;
  /** current — свежий срез; baseline — разовый срез ~30 дней назад, чтобы рост считался сразу, а не через месяц. */
  kind: "current" | "baseline";
  windowFrom: string;
  windowTo: string;
}

const task = (subject: WbSubject, kind: SnapshotTask["kind"], windowTo: string): SnapshotTask => ({
  subject, kind, windowTo, windowFrom: addDays(windowTo, -(WINDOW_DAYS - 1)),
});

/**
 * Что снять сейчас. Сначала свежие срезы всех предметов, потом «прошлые» — так
 * квота и время сборщика уходят в первую очередь на то, что видно на экране.
 * Ничего не пора снимать — пустой список: прогон по крону тогда не трогает MPSTATS.
 */
export function planSnapshots(existing: SnapshotMeta[], latestClosed: string, subjects: readonly WbSubject[] = WB_SUBJECTS, rotation = 0): SnapshotTask[] {
  const current: SnapshotTask[] = [];
  const baseline: SnapshotTask[] = [];
  for (const subject of subjects) {
    const mine = existing.filter((e) => e.subjectId === subject.id).map((e) => e.windowTo).sort().reverse();
    const latest = mine[0];
    const currentDue = !latest || daysBetween(latest, latestClosed) >= SNAPSHOT_EVERY_DAYS;
    const reference = currentDue ? latestClosed : latest;
    if (currentDue) current.push(task(subject, "current", latestClosed));
    const hasPrevious = mine.some((to) => {
      const gap = daysBetween(to, reference);
      return gap >= PREVIOUS_MIN_GAP && gap <= PREVIOUS_MAX_GAP;
    });
    if (!hasPrevious) baseline.push(task(subject, "baseline", addDays(reference, -PREVIOUS_TARGET_GAP)));
  }
  return [...rotate(current, rotation), ...rotate(baseline, rotation)];
}

/**
 * Сдвиг очереди: если предмет в голове плана стабильно не снимается (ответ дольше
 * таймаута, пустой список), следующий запуск начинает не с него — иначе он съедает
 * время и квоту каждого запуска, а остальные предметы не снимаются вовсе.
 */
function rotate<T>(list: T[], by: number): T[] {
  if (list.length < 2) return list;
  const shift = ((Math.floor(by) % list.length) + list.length) % list.length;
  return [...list.slice(shift), ...list.slice(0, shift)];
}

/** «Прошлый» срез к свежему: ближе всего к 30 дням назад в допуске; нет — null (роста не показываем). */
export function pickPrevious<T extends { windowTo: string }>(snapshots: T[], currentTo: string): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const snap of snapshots) {
    const gap = daysBetween(snap.windowTo, currentTo);
    if (gap < PREVIOUS_MIN_GAP || gap > PREVIOUS_MAX_GAP) continue;
    const distance = Math.abs(gap - PREVIOUS_TARGET_GAP);
    // При равном расстоянии (28 и 32 дня) берём более ранний срез: ответ не зависит от порядка строк в базе.
    if (distance < bestDistance || (distance === bestDistance && best && snap.windowTo < best.windowTo)) {
      best = snap;
      bestDistance = distance;
    }
  }
  return best;
}

/** Свежий срез предмета старше самого свежего по разделу больше чем на столько дней — в расчёт не берём. */
export const MAX_SUBJECT_LAG_DAYS = 14;

/**
 * Предмет, у которого свежий срез не снялся (остался только «прошлый» месячной
 * давности), не должен выглядеть свежим: доли форм считались бы по смеси дат.
 */
export function isLagging(newestTo: string, subjectTo: string): boolean {
  return daysBetween(subjectTo, newestTo) > MAX_SUBJECT_LAG_DAYS;
}

/** Предметы с актуальным срезом и отставшие (их срез старше самого свежего больше чем на две недели). */
export function splitLagging<T extends { windowTo: string }>(subjects: T[]): { fresh: T[]; lagging: T[] } {
  const newest = subjects.map((s) => s.windowTo).sort().reverse()[0];
  if (!newest) return { fresh: [], lagging: [] };
  return { fresh: subjects.filter((s) => !isLagging(newest, s.windowTo)), lagging: subjects.filter((s) => isLagging(newest, s.windowTo)) };
}

// ---------------------------------------------------------------------------
// Спрос по формам

export interface SubjectQueries {
  subject: string;
  windowFrom: string;
  windowTo: string;
  current: KeywordRow[];
  previousTo: string | null;
  previous: KeywordRow[] | null;
}

interface DistinctQuery {
  word: string;
  now: number;
  before: number | null;
}

/**
 * Один запрос — одна строка по всем предметам: «бомбер женский» есть и в «Куртках»,
 * и в «Бомберах», но частотность у него одна — складывать её нельзя.
 */
export function distinctQueries(subjects: Array<Pick<SubjectQueries, "current" | "previous">>): Map<string, DistinctQuery> {
  const out = new Map<string, DistinctQuery>();
  for (const subject of subjects) {
    for (const row of subject.current) {
      const key = normalizeTitle(row.word);
      if (!key) continue;
      const now = Number(row.wb_count) || 0;
      const prev = out.get(key);
      if (!prev) out.set(key, { word: row.word, now, before: null });
      else if (now > prev.now) {
        prev.now = now;
        prev.word = row.word;
      }
    }
  }
  for (const subject of subjects) {
    for (const row of subject.previous ?? []) {
      const entry = out.get(normalizeTitle(row.word));
      if (!entry) continue;
      const before = Number(row.wb_count) || 0;
      entry.before = Math.max(entry.before ?? 0, before);
    }
  }
  return out;
}

/** Правила исключения живут в wbExclusions.ts (их читает и спрос по модели); здесь — для прежних импортов. */
export { excludedReason, type ExcludedReason };

export interface FormDemandRow {
  key: string;
  label: string;
  generic: boolean;
  /** Сколько разных запросов отнесено к форме. */
  queries: number;
  /** Сумма частотности этих запросов. */
  searches: number;
  /** Доля среди запросов с названной формой (без «куртка»/«сумка» вообще), %; у общей формы — null. */
  shareOfNamed: number | null;
  growthPct: number | null;
  top: Array<{ word: string; searches: number }>;
}

/**
 * Можно ли доверять «росту»: none — прошлого среза нет; identical — у почти всех общих запросов частотность та же, что и
 * в прошлом срезе (это не два разных периода: срез сняли повторно или MPSTATS отдал те же числа); ok — срезы различаются.
 */
export type GrowthBase = "ok" | "none" | "identical";
/** Доля общих запросов с той же частотностью, с которой срезы считаются «совпавшими» (порог наш, не свойство данных). */
export const GROWTH_IDENTICAL_SHARE = 0.9;
/** Меньше общих запросов — судить, совпали ли срезы, рано. */
export const GROWTH_IDENTICAL_MIN_QUERIES = 30;

export function growthBaseOf(entries: Iterable<{ now: number; before: number | null }>): GrowthBase {
  let compared = 0;
  let same = 0;
  for (const e of entries) {
    if (e.before == null) continue;
    compared += 1;
    if (e.before === e.now) same += 1;
  }
  if (compared === 0) return "none";
  return compared >= GROWTH_IDENTICAL_MIN_QUERIES && same / compared >= GROWTH_IDENTICAL_SHARE ? "identical" : "ok";
}

export interface FormDemandReport {
  direction: AssortmentDirection;
  /** Дата, на которую снята свежая частотность (самая поздняя среди предметов). */
  windowTo: string;
  previousTo: string | null;
  /** Годится ли «рост» как сравнение двух разных периодов; при identical рост по формам не считается. */
  growthBase: GrowthBase;
  subjects: string[];
  /** Сколько предметов раздела в расчёте и сколько их всего: срез мог не сняться по части предметов. */
  subjectsTotal: number;
  /** Предметы, чей срез старше остальных больше чем на две недели, — исключены из расчёта. */
  laggingSubjects: string[];
  /** Запросы в расчёте (без исключённых). */
  queries: number;
  searches: number;
  /** Исключено из расчёта: мужское, детское, не по теме (частотность). */
  excluded: { queries: number; searches: number; men: number; kids: number; other: number };
  /** Частотность запросов с конкретной формой. */
  named: number;
  rows: FormDemandRow[];
  /** Запросы, где форма не названа и общего слова нет («женская зимняя» без «куртка»). */
  unnamed: { queries: number; searches: number };
}

const pct1 = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

export function demandByForm(direction: AssortmentDirection, allSubjects: SubjectQueries[], subjectsTotal = subjectsFor(direction).length): FormDemandReport | null {
  if (!allSubjects.length) return null;
  const { fresh: subjects, lagging } = splitLagging(allSubjects);
  const laggingSubjects = lagging.map((s) => s.subject);
  const rules = rulesFor(direction);
  const distinct = distinctQueries(subjects);
  const growthBase = growthBaseOf([...distinct.values()].filter((e) => !excludedReason(e.word)));
  const excluded = { queries: 0, searches: 0, men: 0, kids: 0, other: 0 };
  const acc = new Map<string, { queries: number; searches: number; now: number; before: number; list: Array<{ word: string; searches: number }> }>();
  let searches = 0;
  let unnamedQueries = 0;
  let unnamedSearches = 0;
  for (const entry of distinct.values()) {
    const reason = excludedReason(entry.word);
    if (reason) {
      excluded.queries += 1;
      excluded.searches += entry.now;
      excluded[reason] += entry.now;
      continue;
    }
    searches += entry.now;
    const text = normalizeTitle(entry.word);
    const rule = rules.find((r) => r.re.test(text));
    if (!rule) {
      unnamedQueries += 1;
      unnamedSearches += entry.now;
      continue;
    }
    const row = acc.get(rule.key) ?? { queries: 0, searches: 0, now: 0, before: 0, list: [] };
    row.queries += 1;
    row.searches += entry.now;
    // Рост — только по запросам, что были в обоих срезах: новый запрос в топе не превращается в «+∞%».
    if (entry.before != null) {
      row.now += entry.now;
      row.before += entry.before;
    }
    row.list.push({ word: entry.word, searches: entry.now });
    acc.set(rule.key, row);
  }

  const named = rules.filter((r) => !r.generic).reduce((sum, r) => sum + (acc.get(r.key)?.searches ?? 0), 0);
  const rows: FormDemandRow[] = rules.filter((r) => acc.has(r.key)).map((rule) => {
    const row = acc.get(rule.key)!;
    return {
      key: rule.key,
      label: rule.label,
      generic: Boolean(rule.generic),
      queries: row.queries,
      searches: row.searches,
      shareOfNamed: rule.generic ? null : pct1(row.searches, named),
      growthPct: growthBase === "ok" && row.before >= MIN_GROWTH_BASE ? growth(row.now, row.before) : null,
      top: row.list.sort((a, b) => b.searches - a.searches || a.word.localeCompare(b.word)).slice(0, 3),
    };
  });
  rows.sort((a, b) => Number(a.generic) - Number(b.generic) || b.searches - a.searches || a.key.localeCompare(b.key));

  const windowTo = subjects.map((s) => s.windowTo).sort().reverse()[0];
  const previousTos = subjects.map((s) => s.previousTo).filter((v): v is string => Boolean(v)).sort().reverse();
  return {
    direction,
    windowTo,
    previousTo: previousTos[0] ?? null,
    growthBase,
    subjects: subjects.map((s) => s.subject),
    subjectsTotal,
    laggingSubjects,
    queries: distinct.size - excluded.queries,
    searches,
    excluded,
    named,
    rows,
    unnamed: { queries: unnamedQueries, searches: unnamedSearches },
  };
}
