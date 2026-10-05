import { plural } from "@/lib/warehouse/plural";
import { APPEARANCE_MIN_SPAN_DAYS, DYNAMICS_MIN_DAYS, DYNAMICS_MIN_SPAN_DAYS, type HistoryStatus } from "./observationState";

/**
 * «На чём стоят цифры» (движок тенденций): что копится, с какого дня и когда функция станет честной. Чистые функции.
 *
 * Экран «Формы» показывает доли и срезы, у каждой из которых своя глубина данных: признаки по фото разбираются несколько
 * суток, срез спроса WB снимается раз в неделю, история каталогов копится с первого обхода. Без этой полоски владелец
 * решает «ждать или поднимать потолок» вслепую. Функции без данных не показываются вовсе (прячем, а не серим), а сбой чтения
 * части называется отдельной строкой — молчание выглядело бы как «данных нет».
 * Даты — расчёт по текущим порогам, не обещание: пороги наши, не свойство данных.
 */

export type ReadinessKind = "факт" | "расчёт" | "оценка";

export interface ReadinessLine {
  kind: ReadinessKind;
  text: string;
  problem?: boolean;
}

export interface ReadinessGroup {
  key: "traits" | "demand" | "history";
  title: string;
  /** Одна фраза для свёрнутой полоски. */
  summary: string;
  lines: ReadinessLine[];
  problem: boolean;
}

export interface ReadinessReport {
  groups: ReadinessGroup[];
  /** Есть что-то, что владельцу нужно увидеть без раскрытия. */
  problem: boolean;
  /** Части, которые не прочитались: названы, а не спрятаны. */
  errors: string[];
}

export interface TraitsFacts {
  enabled: boolean;
  keyConfigured: boolean;
  /** У выбранной модели есть цена в таблице: без неё сборщик не запускается (бюджет нечем считать). */
  priced: boolean;
  model: string;
  /** Разобрано по текущей версии вопроса (из того же отчёта, что блок «Признаки по фото»). */
  analyzed: number;
  /** Разобрано по прежней версии вопроса — пересоберётся. */
  legacy: number;
  /** Моделей, которые вообще можно разобрать: с фото, без «Рынка РФ» — знаменатель того же отчёта. */
  eligible: number;
  /** Неудавшихся строк сейчас (из них часть повторится, часть исчерпала попытки). */
  failed: number;
  /** За последние 7 суток: удалось и не удалось — по ним судим, «сломалось ли сейчас», а не по накопленному. */
  recentOk: number;
  recentFailed: number;
  /** Когда в последний раз успешно разобрана модель, ISO; null — ни одной. */
  lastOkAt: string | null;
  /** Сколько осталось разобрать в ДРУГОМ разделе: очередь сборщика общая; null — не удалось узнать. */
  otherRemaining: number | null;
  callsToday: number;
  dailyLimit: number;
  weekUsd: number;
  weeklyBudgetUsd: number;
  /** На сколько вызовов хватит остатка бюджета недели; null — цены нет. */
  budgetCallsLeft: number | null;
  lastErrors: Array<{ message: string; count: number }>;
}

export interface DemandFacts {
  subjectsTotal: number;
  /** Предметов со свежим срезом — тех, что «Формы» берут в расчёт (отставшие больше чем на две недели не считаются). */
  subjectsFresh: number;
  /** Отставших предметов: срез есть, но «Формы» его не берут. */
  subjectsLagging: number;
  /** Из свежих — у скольких есть «прошлый» срез для роста. */
  withPrevious: number;
  /** Дата самого свежего среза, YYYY-MM-DD; null — срезов нет. */
  latestTo: string | null;
}

export interface HistorySource {
  name: string;
  status: HistoryStatus;
  /** Первый день с прогоном любого покрытия и первый с ПОЛНЫМ прогоном (от него считается «появилось/пропало»). */
  firstDay: string | null;
  firstFullDay: string | null;
}

export interface HistoryFacts {
  sources: HistorySource[];
}

export interface ReadinessInput {
  today: string;
  nowMs: number;
  traits: TraitsFacts | null;
  demand: DemandFacts | null;
  history: HistoryFacts | null;
  /** Части, что не прочитались: названия для строки «не загрузилось». */
  errors?: string[];
}

/** Один прогон крона разбирает до RUN_CAP моделей (минимум около 75: пачки по три, новая не начинается после 150-й секунды), прогонов в сутки — 12. */
export const CATALOG_AI_RUN_CAP = 120;
export const CATALOG_AI_RUN_MIN = 75;
export const CATALOG_AI_RUNS_PER_DAY = 12;
/** Срез спроса снимается раз в неделю; старше этого — сборщик не отработал. */
export const DEMAND_STALE_DAYS = 10;
/** Доля неразобранных среди попыток за последние 7 суток, с которой это — проблема, а не «бывает» (порог наш), и минимум попыток для суждения. */
export const FAILED_SHARE_PROBLEM = 0.2;
export const FAILED_MIN_ATTEMPTS = 20;
/** Сколько часов без единой разобранной модели при непустой очереди и рабочих условиях — «разбор не движется». */
export const STALL_HOURS = 24;

const DAY_MS = 24 * 3600 * 1000;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const num = (n: number) => n.toLocaleString("ru-RU");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const laterOf = (a: string, b: string) => (a >= b ? a : b);
const usd = (n: number) => `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** «около суток», «около 4 суток». */
const aroundDays = (n: number) => (n <= 1 ? "около суток" : `около ${n} суток`);

function traitsGroup(t: TraitsFacts, nowMs: number): ReadinessGroup {
  const lines: ReadinessLine[] = [];
  const pct = t.eligible > 0 ? Math.round((t.analyzed / t.eligible) * 1000) / 10 : 0;
  lines.push({ kind: "факт", text: `Разобрано по фото ${num(t.analyzed)} из ${num(t.eligible)} ${plural(t.eligible, "модели", "моделей", "моделей")} (${pct.toLocaleString("ru-RU")}%)${t.legacy > 0 ? `; ещё ${num(t.legacy)} разобраны по прежнему вопросу и пересоберутся` : ""}.` });

  // Остановки: сборщик не работает по настройке — каждое состояние названо, а не «около суток».
  const budgetGone = t.weeklyBudgetUsd > 0 && t.weekUsd >= t.weeklyBudgetUsd;
  const stops: string[] = [];
  if (!t.enabled) stops.push("Разбор выключен (ASSORTMENT_CATALOG_AI=off): новые модели не разбираются.");
  else if (!t.keyConfigured) stops.push("У разбора нет ключа ИИ: он ждёт, пока ключ будет задан.");
  else if (!t.priced) stops.push(`Для модели «${t.model}» нет цены в таблице: сборщик не запускается (бюджет нечем считать).`);
  else if (t.dailyLimit <= 0) stops.push("Потолок суток 0: разбор остановлен.");
  else if (t.weeklyBudgetUsd <= 0) stops.push("Бюджет недели 0: разбор остановлен.");
  else if (budgetGone) stops.push("Бюджет недели исчерпан — разбор встанет до освобождения бюджета.");
  for (const text of stops) lines.push({ kind: "факт", text, problem: true });
  let problem = stops.length > 0;
  const running = stops.length === 0;

  lines.push({ kind: "факт", text: `Сегодня вызовов ${num(t.callsToday)} из ${num(t.dailyLimit)}; за 7 дней потрачено ${usd(t.weekUsd)} из ${usd(t.weeklyBudgetUsd)}.` });

  const remaining = Math.max(0, t.eligible - t.analyzed);
  const other = t.otherRemaining ?? 0;
  const total = remaining + other;
  if (total === 0) {
    lines.push({ kind: "факт", text: "Очередь разобрана: новые модели подхватятся следующими прогонами." });
  } else if (running) {
    const perDayMax = Math.min(t.dailyLimit, CATALOG_AI_RUN_CAP * CATALOG_AI_RUNS_PER_DAY);
    const perDayMin = Math.min(t.dailyLimit, CATALOG_AI_RUN_MIN * CATALOG_AI_RUNS_PER_DAY);
    const fast = Math.ceil(total / perDayMax);
    const slow = Math.ceil(total / perDayMin);
    const span = fast === slow ? aroundDays(fast) : `от ${fast} до ${slow} суток`;
    lines.push({
      kind: "расчёт",
      text: `Осталось разобрать ${num(remaining)}${other > 0 ? ` (в другом разделе ещё ${num(other)}: очередь у сборщика общая)` : ""}; при потолке ${num(perDayMax)} в сутки (прогон — 75–120 моделей, 12 прогонов) на всё уйдёт ${span}.`,
    });
    if (t.budgetCallsLeft !== null && t.budgetCallsLeft < total) {
      lines.push({ kind: "расчёт", text: `Остатка бюджета недели хватит примерно на ${num(Math.max(0, t.budgetCallsLeft))} вызовов — меньше очереди (${num(total)}): разбор встанет раньше, чем она закончится.` });
    }
  }

  // «Не движется»: условия рабочие, очередь есть, а последняя модель разобрана давно.
  if (running && total > 0 && !budgetGone) {
    const lastOk = t.lastOkAt ? Date.parse(t.lastOkAt) : null;
    const stalled = lastOk === null ? false : nowMs - lastOk > STALL_HOURS * 3600 * 1000;
    if (lastOk !== null) {
      const at = new Date(lastOk + 3 * 3600 * 1000).toISOString();
      lines.push({ kind: "факт", text: `Последняя модель разобрана ${dm(at.slice(0, 10))} в ${at.slice(11, 16)} МСК.${stalled ? ` Прошло больше ${STALL_HOURS} часов при непустой очереди — разбор не движется (проверьте журнал крона и ключ).` : ""}`, problem: stalled });
    }
    if (stalled) problem = true;
  }

  if (t.failed > 0) {
    const tried = t.recentOk + t.recentFailed;
    const share = tried > 0 ? t.recentFailed / tried : 0;
    const bad = tried >= FAILED_MIN_ATTEMPTS && share >= FAILED_SHARE_PROBLEM;
    const reasons = t.lastErrors.slice(0, 3).map((e) => `${e.message.slice(0, 80)} (${num(e.count)})`).join("; ");
    lines.push({
      kind: "факт",
      text: `Не разобралось ${num(t.failed)} ${plural(t.failed, "модель", "модели", "моделей")} (повторяются до трёх попыток, дальше остаются неразобранными)${reasons ? `: ${reasons}` : ""}.${tried >= FAILED_MIN_ATTEMPTS ? ` За 7 суток неудачных ${Math.round(share * 100)}% попыток.` : ""}`,
      problem: bad,
    });
    if (bad) problem = true;
  }
  return {
    key: "traits",
    title: "Признаки по фото",
    summary: `разобрано ${num(t.analyzed)} из ${num(t.eligible)}`,
    lines,
    problem,
  };
}

function demandGroup(d: DemandFacts, today: string): ReadinessGroup | null {
  if (!d.latestTo) return null;
  const lines: ReadinessLine[] = [];
  const stale = daysBetween(d.latestTo, today) > DEMAND_STALE_DAYS;
  lines.push({
    kind: "факт",
    text: `Срез спроса на ${dm(d.latestTo)}: предметов в расчёте ${d.subjectsFresh} из ${d.subjectsTotal}${d.subjectsLagging > 0 ? ` (ещё ${d.subjectsLagging} отстали больше чем на две недели — «Формы» их не берут)` : ""}; «прошлый» срез для роста есть у ${d.withPrevious}.${stale ? " Срез старше недели — сборщик не отработал." : ""}`,
    problem: stale,
  });
  if (d.withPrevious === 0) {
    lines.push({ kind: "оценка", text: "«Прошлый» срез для роста сборщик снимает вслед за текущим — колонка «Рост» появится после ближайших прогонов крона; пока её нет." });
  }
  return { key: "demand", title: "Спрос на WB", summary: `срез на ${dm(d.latestTo)}`, lines, problem: stale };
}

const MAX_LISTED = 6;

function historyGroup(h: HistoryFacts, today: string): ReadinessGroup | null {
  const sources = h.sources;
  if (sources.length === 0) return null;
  const names = (statuses: HistoryStatus[]) => sources.filter((s) => statuses.includes(s.status)).map((s) => s.name);
  const lines: ReadinessLine[] = [];
  const dynamics = names(["dynamics"]);
  const appearance = names(["appearance"]);
  const building = sources.filter((s) => s.status === "building" || s.status === "none");
  const windowOnly = names(["window_only"]);
  if (dynamics.length > 0) lines.push({ kind: "факт", text: `Можно смотреть динамику: ${dynamics.join(", ")}.` });
  if (appearance.length > 0) lines.push({ kind: "факт", text: `«Появилось» и «пропало» — наблюдение: ${appearance.join(", ")}.` });
  if (building.length > 0) {
    lines.push({ kind: "факт", text: `История копится: ${building.map((s) => s.name).join(", ")}.` });
    // Сроки — по каждому источнику от ЕГО первого полного прогона; прошедшая дата значит «после ближайшего полного прогона», а не «давно».
    const dated = building.filter((s) => s.firstFullDay).sort((a, b) => (a.firstFullDay as string).localeCompare(b.firstFullDay as string));
    const waiting = building.filter((s) => !s.firstFullDay).map((s) => s.name);
    const parts = dated.slice(0, MAX_LISTED).map((s) => {
      const at = laterOf(addDays(s.firstFullDay as string, APPEARANCE_MIN_SPAN_DAYS), today);
      return `${s.name} — не раньше ${dm(at)}`;
    });
    const rest = dated.length > MAX_LISTED ? ` и ещё ${dated.length - MAX_LISTED}` : "";
    if (parts.length > 0) lines.push({ kind: "оценка", text: `«Появилось» и «пропало» (два полных прогона с разрывом ${APPEARANCE_MIN_SPAN_DAYS} дней): ${parts.join("; ")}${rest}.` });
    if (waiting.length > 0) lines.push({ kind: "оценка", text: `Ждут первого полного прогона: ${waiting.slice(0, MAX_LISTED).join(", ")}${waiting.length > MAX_LISTED ? ` и ещё ${waiting.length - MAX_LISTED}` : ""} — для них даты пока нет.` });
    const firstDays = sources.filter((s) => s.status !== "window_only" && s.firstDay).map((s) => s.firstDay as string).sort();
    if (firstDays.length > 0) {
      lines.push({ kind: "оценка", text: `Динамика — не раньше ${dm(laterOf(addDays(firstDays[0], DYNAMICS_MIN_SPAN_DAYS), today))} (${DYNAMICS_MIN_SPAN_DAYS} дней наблюдений и не меньше ${DYNAMICS_MIN_DAYS} дней с прогонами). До этого на экране только срез на сегодня.` });
    }
  }
  if (windowOnly.length > 0) lines.push({ kind: "факт", text: `Только верх выдачи, «пропало» не определить: ${windowOnly.join(", ")}.` });
  if (lines.length === 0) return null;
  const firstDays = sources.map((s) => s.firstDay).filter((d): d is string => Boolean(d)).sort();
  return { key: "history", title: "История каталогов", summary: firstDays[0] ? `история с ${dm(firstDays[0])}` : "история копится", lines, problem: false };
}

export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const groups = [
    input.traits ? traitsGroup(input.traits, input.nowMs) : null,
    input.demand ? demandGroup(input.demand, input.today) : null,
    input.history ? historyGroup(input.history, input.today) : null,
  ].filter((g): g is ReadinessGroup => g !== null);
  return { groups, problem: groups.some((g) => g.problem), errors: input.errors ?? [] };
}
