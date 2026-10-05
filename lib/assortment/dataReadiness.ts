import { plural } from "@/lib/warehouse/plural";
import { APPEARANCE_MIN_SPAN_DAYS, DYNAMICS_MIN_SPAN_DAYS, type HistoryStatus } from "./observationState";
import { PREVIOUS_MIN_GAP } from "./wbQueries";

/**
 * «На чём стоят цифры» (движок тенденций): что копится, с какого дня и когда функция станет честной. Чистые функции.
 *
 * Экран «Формы» показывает доли и срезы, у каждой из которых своя глубина данных: признаки по фото разбираются несколько
 * суток, срез спроса WB снимается раз в неделю, история каталогов копится с первого обхода. Без этой полоски владелец
 * решает «ждать или поднимать потолок» вслепую. Функции без данных не показываются вовсе (прячем, а не серим).
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
}

export interface TraitsFacts {
  enabled: boolean;
  keyConfigured: boolean;
  /** Разобрано по текущей версии вопроса. */
  analyzed: number;
  /** Разобрано по прежней версии вопроса — пересоберётся. */
  legacy: number;
  failed: number;
  /** Моделей, которые вообще можно разобрать: с фото, без «Рынка РФ». */
  eligible: number;
  callsToday: number;
  dailyLimit: number;
  weekUsd: number;
  weeklyBudgetUsd: number;
  lastErrors: Array<{ message: string; count: number }>;
}

export interface DemandFacts {
  subjectsTotal: number;
  /** Предметов, у которых есть хоть один срез. */
  subjectsWithSnapshot: number;
  /** Предметов, у которых есть «прошлый» срез для роста. */
  withPrevious: number;
  /** Дата самого свежего среза и самого раннего, YYYY-MM-DD; null — срезов нет. */
  latestTo: string | null;
  firstTo: string | null;
}

export interface HistoryFacts {
  sources: Array<{ name: string; status: HistoryStatus; firstDay: string | null }>;
}

export interface ReadinessInput {
  today: string;
  traits: TraitsFacts | null;
  demand: DemandFacts | null;
  history: HistoryFacts | null;
}

/** Один прогон крона разбирает до RUN_CAP моделей, прогонов в сутки — 12 (крон каждые 2 часа); см. runCatalogAi. */
export const CATALOG_AI_RUN_CAP = 120;
export const CATALOG_AI_RUNS_PER_DAY = 12;
/** Срез спроса снимается раз в неделю; старше этого — сборщик не отработал. */
export const DEMAND_STALE_DAYS = 10;
/** Доля неразобранных среди пытавшихся, с которой это — проблема, а не «бывает» (порог наш). */
export const FAILED_SHARE_PROBLEM = 0.2;

const DAY_MS = 24 * 3600 * 1000;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const num = (n: number) => n.toLocaleString("ru-RU");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const usd = (n: number) => `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function traitsGroup(t: TraitsFacts): ReadinessGroup {
  const lines: ReadinessLine[] = [];
  const pct = t.eligible > 0 ? Math.round((t.analyzed / t.eligible) * 1000) / 10 : 0;
  lines.push({ kind: "факт", text: `Разобрано по фото ${num(t.analyzed)} из ${num(t.eligible)} ${plural(t.eligible, "модели", "моделей", "моделей")} (${pct.toLocaleString("ru-RU")}%)${t.legacy > 0 ? `; ещё ${num(t.legacy)} разобраны по прежнему вопросу и пересоберутся` : ""}.` });
  let problem = false;
  if (!t.enabled) {
    lines.push({ kind: "факт", text: "Разбор выключен (ASSORTMENT_CATALOG_AI=off): новые модели не разбираются.", problem: true });
    problem = true;
  } else if (!t.keyConfigured) {
    lines.push({ kind: "факт", text: "У разбора нет ключа ИИ: он ждёт, пока ключ будет задан.", problem: true });
    problem = true;
  }
  const budgetGone = t.weeklyBudgetUsd > 0 && t.weekUsd >= t.weeklyBudgetUsd;
  lines.push({
    kind: "факт",
    text: `Сегодня вызовов ${num(t.callsToday)} из ${num(t.dailyLimit)}; за 7 дней потрачено ${usd(t.weekUsd)} из ${usd(t.weeklyBudgetUsd)}.${budgetGone ? " Бюджет недели исчерпан — разбор встанет до освобождения бюджета." : ""}`,
    problem: budgetGone,
  });
  if (budgetGone) problem = true;
  const remaining = Math.max(0, t.eligible - t.analyzed);
  if (remaining === 0) {
    lines.push({ kind: "факт", text: "Очередь разобрана: новые модели подхватятся следующими прогонами." });
  } else if (t.enabled && t.dailyLimit > 0) {
    const perDay = Math.min(t.dailyLimit, CATALOG_AI_RUN_CAP * CATALOG_AI_RUNS_PER_DAY);
    const days = Math.max(1, Math.ceil(remaining / perDay));
    lines.push({ kind: "расчёт", text: `Осталось разобрать ${num(remaining)}; при ${num(perDay)} в сутки это ${days === 1 ? "около суток" : `около ${days} суток`}.` });
  }
  if (t.failed > 0) {
    const tried = t.analyzed + t.legacy + t.failed;
    const share = tried > 0 ? t.failed / tried : 0;
    const bad = share >= FAILED_SHARE_PROBLEM;
    const reasons = t.lastErrors.slice(0, 3).map((e) => `${e.message.slice(0, 80)} (${num(e.count)})`).join("; ");
    lines.push({ kind: "факт", text: `Не разобралось ${num(t.failed)} ${plural(t.failed, "модель", "модели", "моделей")}${reasons ? `: ${reasons}` : ""}.`, problem: bad });
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
    text: `Срез спроса на ${dm(d.latestTo)}: предметов ${d.subjectsWithSnapshot} из ${d.subjectsTotal}; «прошлый» срез для роста есть у ${d.withPrevious}.${stale ? " Срез старше недели — сборщик не отработал." : ""}`,
    problem: stale,
  });
  if (d.withPrevious === 0 && d.firstTo) {
    lines.push({ kind: "оценка", text: `Рост поисков появится не раньше ${dm(addDays(d.firstTo, PREVIOUS_MIN_GAP))}: нужен срез не менее чем на ${PREVIOUS_MIN_GAP} дней раньше свежего. Пока колонки «Рост» нет.` });
  }
  return { key: "demand", title: "Спрос на WB", summary: `срез на ${dm(d.latestTo)}`, lines, problem: stale };
}

function historyGroup(h: HistoryFacts): ReadinessGroup | null {
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
    const first = building.map((s) => s.firstDay).filter((d): d is string => Boolean(d)).sort()[0];
    lines.push({ kind: "факт", text: `История копится: ${building.map((s) => s.name).join(", ")}.` });
    if (first) lines.push({ kind: "оценка", text: `«Появилось» и «пропало» — не раньше ${dm(addDays(first, APPEARANCE_MIN_SPAN_DAYS))} (два полных прогона с разрывом ${APPEARANCE_MIN_SPAN_DAYS} дней), динамика — не раньше ${dm(addDays(first, DYNAMICS_MIN_SPAN_DAYS))} (${DYNAMICS_MIN_SPAN_DAYS} дней наблюдений). До этого на экране только срез на сегодня.` });
  }
  if (windowOnly.length > 0) lines.push({ kind: "факт", text: `Только верх выдачи, «пропало» не определить: ${windowOnly.join(", ")}.` });
  if (lines.length === 0) return null;
  const firstDays = sources.map((s) => s.firstDay).filter((d): d is string => Boolean(d)).sort();
  return { key: "history", title: "История каталогов", summary: firstDays[0] ? `история с ${dm(firstDays[0])}` : "история копится", lines, problem: false };
}

export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const groups = [
    input.traits ? traitsGroup(input.traits) : null,
    input.demand ? demandGroup(input.demand, input.today) : null,
    input.history ? historyGroup(input.history) : null,
  ].filter((g): g is ReadinessGroup => g !== null);
  return { groups, problem: groups.some((g) => g.problem) };
}
