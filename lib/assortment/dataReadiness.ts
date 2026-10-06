import { plural } from "@/lib/warehouse/plural";
import { STOP_REASON_WORDS, type CatalogStopReason, type OutsideBySource } from "./catalogAi";
import { APPEARANCE_MIN_SPAN_DAYS, DYNAMICS_MIN_DAYS, DYNAMICS_MIN_SPAN_DAYS, partsCaveat, type HistoryStatus } from "./observationState";

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
  /** Сколько моделей сборщик ещё возьмёт (новые, повторы, пересбор прежней версии) — по тому же правилу, что у самого сборщика. */
  queued: number;
  /** Не возьмёт никогда: три неудачные попытки; и пока обход не перепишет ключ — нестабильный ключ. В «осталось разобрать» не входят. */
  exhausted: number;
  unstable: number;
  /** Неудавшихся строк сейчас (из них часть повторится, часть исчерпала попытки). */
  failed: number;
  /** За последние 7 суток: удалось и не удалось (включая неудачный пересбор старой строки) — по ним судим, «сломалось ли сейчас», а не по накопленному. */
  recentOk: number;
  recentFailed: number;
  /** Когда в последний раз успешно (без ошибки) разобрана модель, ISO; null — ни одной (или не прочиталось — см. readFailed). */
  lastOkAt: string | null;
  /** Когда сборщик в последний раз пробовал разобрать что-либо (удачно или нет), ISO; null — следов попыток нет. */
  lastAttemptAt: string | null;
  /** Чтение времени последней модели/попытки не удалось: «ни одной удачи» по null не заключаем. */
  readFailed?: boolean;
  /** Вида каталога нет (миграция 202610050002): очередь и «из M» неизвестны — ноль не рисуем. */
  catalogMissing?: boolean;
  /** Сколько сборщик ещё возьмёт в ДРУГОМ разделе: очередь общая; null — не удалось узнать (строка в errors). */
  otherQueued: number | null;
  callsToday: number;
  dailyLimit: number;
  weekUsd: number;
  weeklyBudgetUsd: number;
  /** На сколько вызовов хватит остатка бюджета недели; null — цены нет. */
  budgetCallsLeft: number | null;
  lastErrors: Array<{ message: string; count: number }>;
  /**
   * Вне разбора по источникам раздела — тем же правилом, что очередь сборщика: без ссылок на фото и сайты РФ (в «из M» не входят), фото
   * недоступно и исчерпанные три попытки (входят, но не разберутся). Нет — не узнали (отчёт прежней формы).
   */
  outside?: Array<OutsideBySource & { name: string }>;
  /**
   * Последний прогон крона разбора по журналу (sync_log): время, статус и причина остановки из метки `[stop:…]`. null — прогонов с работой
   * в журнале нет («ещё не запускался»); не задано — журнал не читали или он не прочитался.
   */
  lastRun?: { at: string; status: "ok" | "partial" | "error"; reason: CatalogStopReason | null; message: string | null } | null;
}

/** Причины остановки, которые видны только по журналу крона (окружение их не показывает): ключ не принят, денег нет, лимит, модель, сбой. */
const LOGGED_STOPS: ReadonlySet<CatalogStopReason> = new Set(["auth", "billing", "rate_limit", "config", "errors"]);

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
  /** Части разделов источника (Zara CHAQUETA, коллаборации Uniqlo): их модели в полный прогон не входят. */
  parts?: string[];
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
const mskTime = (iso: string) => {
  const at = new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString();
  return `${dm(at.slice(0, 10))} в ${at.slice(11, 16)} МСК`;
};
/** Сколько источников называть в одной группе строки «вне разбора»; остальные — «и ещё N». */
const OUTSIDE_LISTED = 4;

/** Строка «вне разбора» по источникам: четыре группы, в каждой — число и источники по убыванию; пустые группы не называются. */
function outsideLine(outside: Array<OutsideBySource & { name: string }>, eligible: number): ReadinessLine | null {
  const groups: Array<{ pick: (o: OutsideBySource) => number; label: string; short: string; note: string; inDenominator: boolean }> = [
    { pick: (o) => o.noPhoto, label: "без ссылок на фото", short: "модели без фото", note: "", inDenominator: false },
    { pick: (o) => o.ru, label: "сайты РФ", short: "сайты РФ", note: ": ориентир, а не референс — ИИ их не разбирает", inDenominator: false },
    { pick: (o) => o.photoUnavailable, label: "фото недоступно", short: "«фото недоступно»", note: ": ИИ три раза не смог его скачать", inDenominator: true },
    { pick: (o) => o.exhausted, label: "исчерпаны 3 попытки по другим причинам", short: "исчерпавшие попытки", note: "", inDenominator: true },
  ];
  const present = groups.map((g) => {
    const list = outside.filter((o) => g.pick(o) > 0).sort((x, y) => g.pick(y) - g.pick(x) || x.name.localeCompare(y.name));
    if (list.length === 0) return null;
    const total = list.reduce((sum, o) => sum + g.pick(o), 0);
    const names = list.slice(0, OUTSIDE_LISTED).map((o) => `${o.name} ${num(g.pick(o))}`).join(", ");
    const more = list.length > OUTSIDE_LISTED ? ` и ещё ${list.length - OUTSIDE_LISTED} ${plural(list.length - OUTSIDE_LISTED, "источник", "источника", "источников")}` : "";
    return { ...g, text: `${g.label} — ${num(total)} (${names}${more})${g.note}` };
  }).filter((g): g is NonNullable<typeof g> => g !== null);
  if (present.length === 0) return null;
  const outOf = present.filter((g) => !g.inDenominator).map((g) => g.short);
  const inOf = present.filter((g) => g.inDenominator).map((g) => g.short);
  const tail = [
    outOf.length > 0 ? `${outOf.join(" и ")} в «из ${num(eligible)}» не входят` : null,
    inOf.length > 0 ? `${inOf.join(" и ")} в «из ${num(eligible)}» входят, но не разберутся` : null,
  ].filter(Boolean).join("; ");
  return { kind: "факт", text: `Вне разбора по источникам: ${present.map((g) => g.text).join("; ")}. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.` };
}

function traitsGroup(t: TraitsFacts, nowMs: number): ReadinessGroup {
  const lines: ReadinessLine[] = [];
  const pct = t.eligible > 0 ? Math.round((t.analyzed / t.eligible) * 1000) / 10 : 0;
  lines.push({ kind: "факт", text: `Разобрано по фото ${num(t.analyzed)} из ${num(t.eligible)} ${plural(t.eligible, "модели", "моделей", "моделей")} (${pct.toLocaleString("ru-RU")}%)${t.legacy > 0 ? `; ещё ${num(t.legacy)} разобраны по прежнему вопросу и пересоберутся` : ""}.` });

  // Остановки: сборщик не работает по настройке — каждое состояние названо, а не «около суток».
  // Бюджет кончается раньше нуля: сборщик не делает вызов, на который остатка не хватает (резерв одного вызова).
  const budgetGone = t.weeklyBudgetUsd > 0 && (t.weekUsd >= t.weeklyBudgetUsd || (t.budgetCallsLeft !== null && t.budgetCallsLeft <= 0));
  const stops: string[] = [];
  if (!t.enabled) stops.push(`Сборщик стоит — ${STOP_REASON_WORDS.disabled}: новые модели не разбираются.`);
  else if (!t.keyConfigured) stops.push(`Сборщик стоит — ${STOP_REASON_WORDS.no_key} ИИ: он ждёт, пока ключ будет задан.`);
  else if (!t.priced) stops.push(`Сборщик стоит — ${STOP_REASON_WORDS.no_price}: для модели «${t.model}» нет цены в таблице, бюджет нечем считать.`);
  else if (t.dailyLimit <= 0) stops.push("Потолок суток 0: разбор остановлен.");
  else if (t.weeklyBudgetUsd <= 0) stops.push("Бюджет недели 0: разбор остановлен.");
  else if (budgetGone) stops.push(`Сборщик стоит — ${STOP_REASON_WORDS.budget}: потрачено ${usd(t.weekUsd)} из ${usd(t.weeklyBudgetUsd)}, остатка не хватает даже на один вызов — разбор встанет до освобождения бюджета.`);
  for (const text of stops) lines.push({ kind: "факт", text, problem: true });
  let problem = stops.length > 0;
  const running = stops.length === 0;

  lines.push({ kind: "факт", text: `Сегодня вызовов ${num(t.callsToday)} из ${num(t.dailyLimit)}; за 7 дней потрачено ${usd(t.weekUsd)} из ${usd(t.weeklyBudgetUsd)}.` });
  // Потолок суток — норма (он сбрасывается в полночь), а не поломка: называем, но тревоги нет.
  if (running && t.callsToday >= t.dailyLimit) {
    lines.push({ kind: "факт", text: `Сборщик ${STOP_REASON_WORDS.daily_limit}: сегодня больше не разбирает, продолжит после 00:00 МСК.` });
  }
  // Остановка, которую видно только по журналу крона: ключ не принят, нет денег, лимит, модель недоступна, системный сбой. Без неё
  // полоска говорила бы «не движется, проверьте журнал» — а причина уже известна.
  const loggedStop = running && t.lastRun && t.lastRun.status === "error" && t.lastRun.reason && LOGGED_STOPS.has(t.lastRun.reason) ? t.lastRun : null;
  if (loggedStop) {
    lines.push({
      kind: "факт",
      text: `Последний прогон ${mskTime(loggedStop.at)} остановился — ${STOP_REASON_WORDS[loggedStop.reason as CatalogStopReason]}${loggedStop.message ? `. Ответ: ${loggedStop.message.slice(0, 160)}` : ""}.`,
      problem: true,
    });
    problem = true;
  }

  // Очередь — только то, что сборщик возьмёт: модели, исчерпавшие попытки, и модели с нестабильным ключом в неё не входят
  // (иначе срок «около суток» не наступал бы, а через сутки без новых моделей вылезала бы ложная тревога «не движется»).
  const remaining = t.queued;
  const otherKnown = t.otherQueued !== null;
  const other = t.otherQueued ?? 0;
  const total = remaining + other;
  if (t.catalogMissing) {
    lines.push({ kind: "факт", text: "Каталога для разбора ещё нет (не применена миграция 202610050002): сколько моделей осталось разобрать, посчитать нельзя.", problem: true });
    problem = true;
  } else if (total === 0 && otherKnown) {
    lines.push({ kind: "факт", text: "Очередь разобрана: новые модели подхватятся следующими прогонами." });
  } else if (total === 0) {
    lines.push({ kind: "факт", text: "В этом разделе очередь пуста; очередь другого раздела не прочиталась — общий срок посчитать нельзя." });
  } else if (running) {
    const perDayMax = Math.min(t.dailyLimit, CATALOG_AI_RUN_CAP * CATALOG_AI_RUNS_PER_DAY);
    const perDayMin = Math.min(t.dailyLimit, CATALOG_AI_RUN_MIN * CATALOG_AI_RUNS_PER_DAY);
    const fast = Math.ceil(total / perDayMax);
    const slow = Math.ceil(total / perDayMin);
    const span = fast === slow ? aroundDays(fast) : `от ${fast} до ${slow} суток`;
    const otherNote = !otherKnown ? " (очередь другого раздела не прочиталась — срок без неё)" : other > 0 ? ` (в другом разделе ещё ${num(other)}: очередь у сборщика общая)` : "";
    lines.push({
      kind: "расчёт",
      text: `Осталось разобрать ${num(remaining)}${otherNote}; при потолке ${num(perDayMax)} в сутки (прогон — 75–120 моделей, 12 прогонов) на всё уйдёт ${span}.`,
    });
    if (t.budgetCallsLeft !== null && t.budgetCallsLeft < total) {
      lines.push({ kind: "расчёт", text: `Остатка бюджета недели хватит примерно на ${num(Math.max(0, t.budgetCallsLeft))} вызовов — меньше очереди (${num(total)}): разбор встанет раньше, чем она закончится.` });
    }
  }
  const skipped = t.exhausted + t.unstable;
  if (skipped > 0) {
    const parts = [
      t.exhausted > 0 ? `${num(t.exhausted)} исчерпали три попытки` : null,
      t.unstable > 0 ? `у ${num(t.unstable)} ключ модели в базе не совпал с расчётным (ближайший обход его перепишет)` : null,
    ].filter(Boolean).join("; ");
    lines.push({ kind: "факт", text: `Ещё ${num(skipped)} ${plural(skipped, "модель", "модели", "моделей")} сборщик не возьмёт: ${parts}. В «осталось разобрать» они не входят.` });
  }
  const outside = t.outside && !t.catalogMissing ? outsideLine(t.outside, t.eligible) : null;
  if (outside) lines.push(outside);

  // «Не движется»: условия рабочие, очередь есть, а сборщик давно ничего не пробовал. Судим по последней ПОПЫТКЕ любого рода, а не
  // только по последней удаче: когда в очереди одни повторы внутри суточной паузы, он жив и брать ему сегодня нечего.
  if (running && total > 0) {
    const lastOk = t.lastOkAt ? Date.parse(t.lastOkAt) : null;
    const lastTry = [t.lastAttemptAt ? Date.parse(t.lastAttemptAt) : null, lastOk].filter((x): x is number => x !== null && !Number.isNaN(x)).sort((a, b) => b - a)[0] ?? null;
    if (lastOk !== null) {
      const at = new Date(lastOk + 3 * 3600 * 1000).toISOString();
      lines.push({ kind: "факт", text: `Последняя модель разобрана ${dm(at.slice(0, 10))} в ${at.slice(11, 16)} МСК.` });
    }
    if (lastTry !== null && !loggedStop) {
      const stalled = nowMs - lastTry > STALL_HOURS * 3600 * 1000;
      if (stalled) {
        const at = new Date(lastTry + 3 * 3600 * 1000).toISOString();
        // Вызовы сегодня есть, а записанных попыток нет. Временные сбои (таймаут, перегрузка) пишутся пометкой в строку модели, так что
        // это остановки провайдера без записи (ключ, деньги, лимит) или сбой записи в базу.
        const text = t.callsToday > 0
          ? `Вызовы идут (сегодня ${num(t.callsToday)}), но ни одна модель не записана больше ${STALL_HOURS} часов (последняя запись ${dm(at.slice(0, 10))} в ${at.slice(11, 16)} МСК) при непустой очереди — ответы провайдера не доходят до записи (остановка по ключу, деньгам или лимиту либо сбой записи в базу): проверьте журнал крона.`
          : `Сборщик ничего не пробовал разобрать больше ${STALL_HOURS} часов (последняя попытка ${dm(at.slice(0, 10))} в ${at.slice(11, 16)} МСК) при непустой очереди — разбор не движется (проверьте журнал крона и ключ).`;
        lines.push({ kind: "факт", text, problem: true });
        problem = true;
      }
    }
    if (lastOk === null && t.analyzed === 0 && t.legacy === 0 && !t.readFailed && !loggedStop) {
      // Ни одной удачи, а причины остановки в журнале нет. Пробовал и ни разу не вышло — проблема; следов нет — по журналу видно,
      // запускался ли он вообще («ещё не запускался» — не тревога: первые часы после выкладки).
      const tried = lastTry !== null || t.callsToday > 0 || t.weekUsd > 0 || t.failed > 0 || t.recentFailed > 0;
      const quiet = t.lastRun === null
        ? "Ни одна модель ещё не разобрана: сборщик ещё не запускался — в журнале крона нет ни одного прогона с работой. Срок выше — расчёт на случай, что он заработает."
        : t.lastRun
          ? `Ни одна модель ещё не разобрана и следов попыток нет; последний прогон крона — ${mskTime(t.lastRun.at)}${t.lastRun.message ? ` (${t.lastRun.message.slice(0, 120)})` : ""}. Срок выше — расчёт на случай, что он работает.`
          : "Ни одна модель ещё не разобрана и следов попыток нет: сборщик ещё не запускался или журнал крона не прочитался. Срок выше — расчёт на случай, что он работает.";
      lines.push({
        kind: "факт",
        text: tried ? "Ни одна модель не разобрана, хотя вызовы или неудачи были — проверьте журнал крона, ключ и ответы ИИ." : quiet,
        problem: tried,
      });
      if (tried) problem = true;
    }
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
  } else if (t.recentFailed > 0 && t.recentOk + t.recentFailed >= FAILED_MIN_ATTEMPTS && t.recentFailed / (t.recentOk + t.recentFailed) >= FAILED_SHARE_PROBLEM) {
    // Неудачи есть только у пересборов старых строк (статус «ok» они сохраняют) — в «не разобралось» их нет, а доля высокая.
    const share = t.recentFailed / (t.recentOk + t.recentFailed);
    lines.push({ kind: "факт", text: `За 7 суток неудачных ${Math.round(share * 100)}% попыток (пересбор разобранного по прежнему вопросу) — проверьте журнал крона и ответы ИИ.`, problem: true });
    problem = true;
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
/** Сколько дней сверх положенных 7 ждём второй полный прогон, прежде чем назвать источник застрявшим (обходы идут ежедневно). */
export const STUCK_GRACE_DAYS = 3;

function historyGroup(h: HistoryFacts, today: string): ReadinessGroup | null {
  const sources = h.sources;
  if (sources.length === 0) return null;
  const names = (statuses: HistoryStatus[]) => sources.filter((s) => statuses.includes(s.status)).map((s) => s.name);
  const lines: ReadinessLine[] = [];
  let problem = false;
  const dynamics = names(["dynamics"]);
  const appearance = names(["appearance"]);
  const building = sources.filter((s) => s.status === "building" || s.status === "none");
  const windowOnly = names(["window_only"]);
  const listed = (parts: string[]) => `${parts.slice(0, MAX_LISTED).join("; ")}${parts.length > MAX_LISTED ? ` и ещё ${parts.length - MAX_LISTED}` : ""}`;
  if (dynamics.length > 0) lines.push({ kind: "факт", text: `Можно смотреть динамику: ${dynamics.join(", ")}.` });
  if (appearance.length > 0) lines.push({ kind: "факт", text: `«Появилось» и «пропало» — наблюдение: ${appearance.join(", ")}.` });
  // Часть раздела — отдельная выборка, её прогон окно, а не полный раздел: по её моделям «появилось» и «пропало» не наблюдение, даже
  // когда по источнику оно уже есть.
  const caveat = partsCaveat(sources);
  if (caveat) lines.push({ kind: "факт", text: caveat });
  // Источник с первым полным прогоном давно, а второго всё нет, — застрял: обходы не доходят до конца. Дата для него «не раньше
  // сегодня» печаталась бы каждый день и ничем не отличалась от источника, который будет готов завтра.
  const withFull = building.filter((s) => s.firstFullDay);
  const stuck = withFull.filter((s) => daysBetween(s.firstFullDay as string, today) > APPEARANCE_MIN_SPAN_DAYS + STUCK_GRACE_DAYS);
  const waiting = building.filter((s) => !s.firstFullDay).map((s) => s.name);
  if (building.length > 0) {
    lines.push({ kind: "факт", text: `История копится: ${building.map((s) => s.name).join(", ")}.` });
    // Сроки — по каждому источнику от ЕГО первого полного прогона; прошедшая дата значит «после ближайшего полного прогона», а не «давно».
    const dated = withFull.filter((s) => !stuck.includes(s)).sort((a, b) => (a.firstFullDay as string).localeCompare(b.firstFullDay as string));
    const parts = dated.map((s) => `${s.name} — не раньше ${dm(laterOf(addDays(s.firstFullDay as string, APPEARANCE_MIN_SPAN_DAYS), today))}`);
    if (parts.length > 0) lines.push({ kind: "оценка", text: `«Появилось» и «пропало» (два полных прогона с разрывом ${APPEARANCE_MIN_SPAN_DAYS} дней): ${listed(parts)}.` });
    if (stuck.length > 0) {
      const stuckParts = stuck.map((s) => {
        const days = daysBetween(s.firstFullDay as string, today);
        return `${s.name} (первый ${dm(s.firstFullDay as string)}, уже ${days} ${plural(days, "день", "дня", "дней")})`;
      });
      lines.push({ kind: "факт", text: `Второй полный прогон не приходит: ${listed(stuckParts)}. Пока обходы не доходят до конца, «появилось» и «пропало» по этим источникам не станут наблюдением — проверьте журнал обходов.`, problem: true });
      problem = true;
    }
    if (waiting.length > 0) lines.push({ kind: "оценка", text: `Ждут первого полного прогона: ${listed(waiting.slice())} — для них даты пока нет.` });
  }
  // Динамика — только по источникам, которым её ещё ждать: готовые к ней и застрявшие в дату не входят. Нужно и 28 дней наблюдений
  // от первого прогона, и наблюдение «появилось/пропало» (первый полный +7).
  const pendingDynamics = sources
    .filter((s) => s.firstDay && (s.status === "appearance" || (s.status === "building" && s.firstFullDay && !stuck.includes(s))))
    .map((s) => ({ name: s.name, at: laterOf(laterOf(addDays(s.firstDay as string, DYNAMICS_MIN_SPAN_DAYS), s.status === "building" ? addDays(s.firstFullDay as string, APPEARANCE_MIN_SPAN_DAYS) : ""), today) }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
  if (pendingDynamics.length > 0) {
    lines.push({ kind: "оценка", text: `Динамика (${DYNAMICS_MIN_SPAN_DAYS} дней наблюдений и не меньше ${DYNAMICS_MIN_DAYS} дней с прогонами): ${listed(pendingDynamics.map((p) => `${p.name} — не раньше ${dm(p.at)}`))}. До этого по ним на экране только срез на сегодня.` });
  }
  if (windowOnly.length > 0) lines.push({ kind: "факт", text: `Только верх выдачи, «пропало» не определить: ${windowOnly.join(", ")}.` });
  if (lines.length === 0) return null;
  const firstDays = sources.map((s) => s.firstDay).filter((d): d is string => Boolean(d)).sort();
  return { key: "history", title: "История каталогов", summary: firstDays[0] ? `история с ${dm(firstDays[0])}` : "история копится", lines, problem };
}

export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const groups = [
    input.traits ? traitsGroup(input.traits, input.nowMs) : null,
    input.demand ? demandGroup(input.demand, input.today) : null,
    input.history ? historyGroup(input.history, input.today) : null,
  ].filter((g): g is ReadinessGroup => g !== null);
  return { groups, problem: groups.some((g) => g.problem), errors: input.errors ?? [] };
}
