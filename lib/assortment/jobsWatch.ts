import { escapeTelegramHtml } from "./freshness";

/**
 * Сторож служебных задач движка тенденций (по журналу синхронизаций sync_log).
 *
 * Сторож источников смотрит на то, что собрано; эти задачи пишут не в источники, а
 * в свои таблицы: недельные срезы спроса WB (MPSTATS) и признаки каталога по фото
 * (платный ИИ). Падение у них тихое: срезов нет — экран «Формы» молча без спроса,
 * кончились деньги на ИИ — признаки перестают копиться. Здесь решается, пора ли
 * сказать об этом в Telegram. Чистые функции: правило «одна поломка — одно
 * сообщение, восстановление — второе» проверяется тестом.
 */

export interface JobRun {
  job: string;
  status: "ok" | "partial" | "error";
  error: string | null;
  started_at: string;
}

export interface JobRule {
  job: string;
  label: string;
  /** Сколько суток без единого прогона (любого статуса) — тишина крона; null — не судим: прогон пишется только когда есть работа. */
  maxSilenceDays: number | null;
  /** Сколько последних прогонов подряд с ошибкой — поломка. */
  maxConsecutiveErrors: number;
}

export const WATCHED_JOBS: readonly JobRule[] = [
  // Крон каждые 6 часов и пишет журнал даже когда снимать нечего: 8 ошибок подряд — двое суток.
  { job: "assortment-wb-queries", label: "Спрос WB: недельные срезы запросов (MPSTATS)", maxSilenceDays: 3, maxConsecutiveErrors: 8 },
  // Крон каждые 2 часа, журнал — только когда была работа: 3 ошибки подряд. Ключ, деньги и настройка останавливают прогон сразу и дают
  // «error», но тревога всё равно после трёх; лимит запросов — «error» лишь без единой разобранной модели, неудачи при разобранных — «partial».
  { job: "assortment-catalog-ai", label: "Признаки каталога по фото (ИИ)", maxSilenceDays: null, maxConsecutiveErrors: 3 },
  // «Залетает в соцсетях»: крон ежедневный и пишет журнал каждым прогоном (выключатель off — тоже, строкой «ok»), поэтому
  // тишина 3 суток — пропавший крон; 3 ошибки подряд — три дня без ключа, денег или зоны Bright Data.
  { job: "assortment-social", label: "Залетает в соцсетях: рилсы Instagram (Bright Data)", maxSilenceDays: 3, maxConsecutiveErrors: 3 },
];

export const WATCHED_JOB_NAMES: string[] = WATCHED_JOBS.map((j) => j.job);

export type JobState = "ok" | "stalled" | "awaiting";

export interface JobFreshness {
  job: string;
  label: string;
  state: JobState;
  reason: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface JobsFreshness {
  state: "ok" | "stalled";
  stalled: JobFreshness[];
  jobs: JobFreshness[];
}

const DAY_MS = 24 * 3600 * 1000;

export function jobFreshness(rule: JobRule, runs: JobRun[], nowMs = Date.now()): JobFreshness {
  const mine = runs.filter((r) => r.job === rule.job).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const base = { job: rule.job, label: rule.label };
  if (mine.length === 0) return { ...base, state: "awaiting", reason: null, lastRunAt: null, lastError: null };
  const last = mine[0];
  const lastError = mine.find((r) => r.status === "error")?.error ?? null;
  const streak = mine.slice(0, rule.maxConsecutiveErrors);
  if (streak.length === rule.maxConsecutiveErrors && streak.every((r) => r.status === "error")) {
    return { ...base, state: "stalled", reason: `${rule.maxConsecutiveErrors} прогонов подряд с ошибкой`, lastRunAt: last.started_at, lastError: last.error };
  }
  if (rule.maxSilenceDays != null) {
    const silentDays = Math.floor((nowMs - Date.parse(last.started_at)) / DAY_MS);
    if (silentDays >= rule.maxSilenceDays) {
      return { ...base, state: "stalled", reason: `нет прогонов ${silentDays} сут`, lastRunAt: last.started_at, lastError };
    }
  }
  return { ...base, state: "ok", reason: null, lastRunAt: last.started_at, lastError };
}

export function jobsFreshness(runs: JobRun[], nowMs = Date.now()): JobsFreshness {
  const jobs = WATCHED_JOBS.map((rule) => jobFreshness(rule, runs, nowMs));
  const stalled = jobs.filter((j) => j.state === "stalled");
  return { state: stalled.length ? "stalled" : "ok", stalled, jobs };
}

export const JOBS_ALERT_PREFIX = "assortment-jobs-stalled:";

export interface JobsAlertPlan {
  send: "stalled" | "recovered" | null;
  openKey: string | null;
  resolveKeys: string[];
}

/** Ключ = префикс + набор остановившихся задач: тот же набор — без повторов, новый — новое сообщение. */
export function jobsAlertPlan(freshness: JobsFreshness, openKeys: string[]): JobsAlertPlan {
  const ours = openKeys.filter((key) => key.startsWith(JOBS_ALERT_PREFIX));
  if (freshness.state === "stalled") {
    const openKey = `${JOBS_ALERT_PREFIX}${freshness.stalled.map((j) => j.job).sort().join(",")}`;
    return { send: ours.includes(openKey) ? null : "stalled", openKey, resolveKeys: ours.filter((key) => key !== openKey) };
  }
  return { send: ours.length ? "recovered" : null, openKey: null, resolveKeys: ours };
}

export const JOBS_STALL_ACTION = "Проверьте журнал синхронизаций (sync_log) по этим задачам. Спрос WB — квота и токен MPSTATS; признаки по фото — ключ и баланс ИИ-провайдера (Anthropic или Polza, см. текст ошибки выше; провайдер выбирает ASSORTMENT_CATALOG_AI_PROVIDER); рилсы — ключ, баланс и зона Bright Data (BRIGHTDATA_API_TOKEN, BRIGHTDATA_UNLOCKER_ZONE).";

export function jobsStallMessage(freshness: JobsFreshness): string {
  return `Остановились задачи движка тенденций (${freshness.stalled.length}): ${freshness.stalled.map((j) => j.label).join("; ")}`;
}

export function jobsStallTelegram(freshness: JobsFreshness): string {
  const lines = freshness.stalled.map((j) => {
    const why = [j.reason, j.lastError ? `ошибка: ${j.lastError.slice(0, 100)}` : null].filter(Boolean).join("; ");
    return `• ${escapeTelegramHtml(j.label)} — ${escapeTelegramHtml(why)}`;
  });
  return `🚨 <b>Движок тенденций: задачи остановились (${freshness.stalled.length})</b>\n${lines.join("\n")}\n${JOBS_STALL_ACTION}`;
}

export function jobsRecoveredTelegram(): string {
  return "✅ <b>Задачи движка тенденций снова работают</b>\nСпрос WB, признаки по фото и рилсы идут по расписанию.";
}
