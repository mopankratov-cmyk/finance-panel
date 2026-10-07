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
 *
 * «Нет денег» (402, «Customer is not active») — тревога сразу, по метке `[stop:billing]` в строке журнала, а не после серии ошибок:
 * средовый сбор Zara и Uniqlo, сорванный балансом, иначе всплыл бы только через неделю. Остановка держится, пока у того же провайдера
 * не пройдёт удачная платная покупка (прогон задачи-покупателя с сделанной работой): повторный сбор, забравший уже оплаченное, деньги не
 * доказывает и тревогу не гасит. Одна остановка провайдера — одно сообщение: все задачи, упёршиеся в деньги одного провайдера (запуск и
 * сбор Bright Data, рилсы), — один ключ тревоги.
 *
 * Покупка Bright Data, отложенная потому, что учёт расхода не прочитался (`[stop:engine_read]`), и Zara или Uniqlo, не пущенные общим
 * потолком (`[stop:engine_budget]`), — тоже тревога сразу: они покупаются только по средам, и неделя данных иначе пропала бы молча.
 * Держится до следующей удачной покупки этой задачи.
 */

export interface JobRun {
  job: string;
  status: "ok" | "partial" | "error";
  error: string | null;
  started_at: string;
  /** Сделанная работа прогона (sync_log.rows_affected): у покупки Bright Data — купленные выборки, у рилсов — замеры, у разбора — модели. */
  rows_affected?: number | null;
}

export interface JobRule {
  job: string;
  label: string;
  /** Сколько суток без единого прогона (любого статуса) — тишина крона; null — не судим: прогон пишется только когда есть работа. */
  maxSilenceDays: number | null;
  /** Сколько последних прогонов подряд с ошибкой — поломка; null — серию не судим (за сбором следит сторож источников). */
  maxConsecutiveErrors: number | null;
  /** Чьи деньги тратит задача: «нет денег» у одного провайдера — одна тревога на все его задачи. */
  billing?: "brightdata" | "ai";
  /**
   * Прогон этой задачи без ошибки и с сделанной работой (rows_affected > 0) доказывает, что провайдер снова берёт деньги: покупка выборки,
   * запрос рилсов, разбор модели. У сбора — нет: он скачивает уже оплаченное, а это проходит и без баланса.
   */
  paysProvider?: boolean;
  /** Метки остановки (кроме billing), по которым задача — сразу «остановилась», и словами — почему; держится до её удачного прогона с работой. */
  stopTags?: Readonly<Record<string, string>>;
}

/** Метки остановки покупки Bright Data: учёт расхода не прочитался; Zara или Uniqlo не пущены общим потолком. */
export const BRIGHTDATA_TRIGGER_STOPS: Readonly<Record<string, string>> = {
  engine_read: "учёт расхода движка не прочитался и после повторов — покупки дня отложены, чтобы не платить вслепую; Zara и Uniqlo покупаются только по средам — повторите вручную ?phase=trigger&source=S001&force=1 (и S003)",
  engine_budget: "общий потолок движка не пустил покупку Zara или Uniqlo (они покупаются только по средам) — проверьте ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD и «Расход движка» на полоске «На чём стоят цифры»",
};

export const WATCHED_JOBS: readonly JobRule[] = [
  // Крон каждые 6 часов и пишет журнал даже когда снимать нечего: 8 ошибок подряд — двое суток.
  { job: "assortment-wb-queries", label: "Спрос WB: недельные срезы запросов (MPSTATS)", maxSilenceDays: 3, maxConsecutiveErrors: 8 },
  // Крон каждые 2 часа, журнал — только когда была работа: 3 ошибки подряд. Ключ, деньги и настройка останавливают прогон сразу и дают
  // «error», но тревога всё равно после трёх; лимит запросов — «error» лишь без единой разобранной модели, неудачи при разобранных — «partial».
  { job: "assortment-catalog-ai", label: "Признаки каталога по фото (ИИ)", maxSilenceDays: null, maxConsecutiveErrors: 3, billing: "ai", paysProvider: true },
  // «Залетает в соцсетях»: крон каждые 3 часа (с 07.10) и пишет журнал каждым прогоном (выключатель off — тоже, строкой «ok»), поэтому
  // сутки тишины — пропавший крон (8 прогонов без записи); 8 ошибок подряд — сутки без ключа или зоны Bright Data; нет денег — сразу.
  { job: "assortment-social", label: "Залетает в соцсетях: рилсы Instagram (Bright Data)", maxSilenceDays: 1, maxConsecutiveErrors: 8, billing: "brightdata", paysProvider: true },
  // Bright Data по средам и субботам: запуск и сбор. Прочие сбои видит сторож источников (по last_success_at), здесь — «нет денег» и
  // отложенная покупка (учёт не прочитался, потолок не пустил Zara или Uniqlo): сорванная покупка Zara и Uniqlo — тревога в тот же день,
  // а не через неделю молчания источника.
  { job: "assortment-brightdata-trigger", label: "Bright Data: покупка выборок (Zara, Uniqlo, ASOS, H&M)", maxSilenceDays: null, maxConsecutiveErrors: null, billing: "brightdata", paysProvider: true, stopTags: BRIGHTDATA_TRIGGER_STOPS },
  { job: "assortment-brightdata-collect", label: "Bright Data: сбор оплаченных выборок", maxSilenceDays: null, maxConsecutiveErrors: null, billing: "brightdata" },
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
  /** Остановилась по деньгам: чьим (одна тревога на провайдера). */
  billing?: "brightdata" | "ai";
}

export interface JobsFreshness {
  state: "ok" | "stalled";
  stalled: JobFreshness[];
  jobs: JobFreshness[];
}

const DAY_MS = 24 * 3600 * 1000;

/** Метка остановки в конце строки журнала (stopTag у разбора по фото, Bright Data и рилсов). */
const STOP_TAG = /\[stop:([a-z_]+)\]\s*$/;

/** Метка остановки прогона: только у прогона с ошибкой (метка в тексте удачного прогона — не остановка). */
function stopOf(run: JobRun): string | null {
  return run.status === "error" ? STOP_TAG.exec(run.error ?? "")?.[1] ?? null : null;
}

/** Прогон сделал платную работу: без ошибки, с работой, без остановки по деньгам. */
function paidWork(run: JobRun): boolean {
  return run.status !== "error" && (run.rows_affected ?? 0) > 0;
}

/** Когда провайдер последний раз доказал, что берёт деньги: удачный прогон с работой любой его задачи-покупателя. null — ни разу. */
function lastProviderProof(provider: NonNullable<JobRule["billing"]>, runs: JobRun[]): string | null {
  const payers = new Set(WATCHED_JOBS.filter((j) => j.billing === provider && j.paysProvider).map((j) => j.job));
  return runs.filter((r) => payers.has(r.job) && paidWork(r)).map((r) => r.started_at).sort().pop() ?? null;
}

export const BILLING_REASON = "нет денег у провайдера или аккаунт не активен (402) — платные запуски остановлены";

export function jobFreshness(rule: JobRule, runs: JobRun[], nowMs = Date.now()): JobFreshness {
  const mine = runs.filter((r) => r.job === rule.job).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const base = { job: rule.job, label: rule.label };
  if (mine.length === 0) return { ...base, state: "awaiting", reason: null, lastRunAt: null, lastError: null };
  const last = mine[0];
  const lastError = mine.find((r) => r.status === "error")?.error ?? null;
  // Нет денег — сразу, а не после серии, и держится, пока у провайдера не пройдёт удачная платная покупка: прогон этой задачи остановился
  // по 402 позже последнего доказательства, что деньги снова есть (повторный сбор, забравший оплаченное, — не доказательство).
  if (rule.billing) {
    const proof = lastProviderProof(rule.billing, runs);
    const stop = mine.find((r) => stopOf(r) === "billing" && (proof === null || r.started_at > proof));
    if (stop) return { ...base, state: "stalled", reason: BILLING_REASON, lastRunAt: last.started_at, lastError: stop.error, billing: rule.billing };
  }
  // Свои метки остановки (покупка Bright Data отложена) — сразу; держатся до удачного прогона этой задачи с работой.
  if (rule.stopTags) {
    const proof = mine.find(paidWork)?.started_at ?? null;
    const stop = mine.find((r) => {
      const tag = stopOf(r);
      return tag !== null && Object.prototype.hasOwnProperty.call(rule.stopTags, tag) && (proof === null || r.started_at > proof);
    });
    if (stop) return { ...base, state: "stalled", reason: rule.stopTags[stopOf(stop)!], lastRunAt: last.started_at, lastError: stop.error };
  }
  const streak = rule.maxConsecutiveErrors == null ? [] : mine.slice(0, rule.maxConsecutiveErrors);
  if (rule.maxConsecutiveErrors != null && streak.length === rule.maxConsecutiveErrors && streak.every((r) => r.status === "error")) {
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

/**
 * Сторож задач держит тревогу «нет денег» Bright Data: источники Bright Data, молчащие по этой причине, сторож источников второй тревогой
 * не называет (одна остановка — одно сообщение).
 */
export function brightdataBillingAlarm(freshness: JobsFreshness): boolean {
  return freshness.stalled.some((j) => j.billing === "brightdata");
}

export const JOBS_ALERT_PREFIX = "assortment-jobs-stalled:";

export interface JobsAlertPlan {
  send: "stalled" | "recovered" | null;
  openKey: string | null;
  resolveKeys: string[];
}

/** Чем остановка отличается от других для ключа тревоги: «нет денег» — провайдером (все его задачи — одна тревога), остальное — задачей. */
export function stallIdentity(job: Pick<JobFreshness, "job" | "billing">): string {
  return job.billing ? `billing:${job.billing}` : job.job;
}

/**
 * Ключ = префикс + набор остановок: тот же набор — без повторов, новый — новое сообщение. Деньги одного провайдера — одна остановка:
 * рилсы упёрлись в 402 во вторник, запуск Bright Data — в среду, — сообщение одно.
 */
export function jobsAlertPlan(freshness: JobsFreshness, openKeys: string[]): JobsAlertPlan {
  const ours = openKeys.filter((key) => key.startsWith(JOBS_ALERT_PREFIX));
  if (freshness.state === "stalled") {
    const openKey = `${JOBS_ALERT_PREFIX}${[...new Set(freshness.stalled.map(stallIdentity))].sort().join(",")}`;
    return { send: ours.includes(openKey) ? null : "stalled", openKey, resolveKeys: ours.filter((key) => key !== openKey) };
  }
  return { send: ours.length ? "recovered" : null, openKey: null, resolveKeys: ours };
}

export const JOBS_STALL_ACTION = "Проверьте журнал синхронизаций (sync_log) по этим задачам. Спрос WB — квота и токен MPSTATS; признаки по фото — ключ и баланс ИИ-провайдера (Anthropic или Polza, см. текст ошибки выше; провайдер выбирает ASSORTMENT_CATALOG_AI_PROVIDER); рилсы и выборки Bright Data — ключ, баланс и зона Bright Data (BRIGHTDATA_API_TOKEN, BRIGHTDATA_UNLOCKER_ZONE). Оплаченные выборки ждут в очереди: после пополнения их заберёт ближайший сбор (или вручную ?phase=collect).";

export function jobsStallMessage(freshness: JobsFreshness): string {
  return `Остановились задачи движка тенденций (${freshness.stalled.length}): ${freshness.stalled.map((j) => j.label).join("; ")}`;
}

const PROVIDER_LABEL: Record<NonNullable<JobRule["billing"]>, string> = { brightdata: "Bright Data", ai: "ИИ-провайдер разбора по фото" };

export function jobsStallTelegram(freshness: JobsFreshness): string {
  // Метка причины `[stop:…]` в конце строки журнала — для полоски «На чём стоят цифры» и сторожа, в сообщении она лишняя.
  const clean = (error: string | null) => (error ? error.replace(/\s*\[stop:[a-z_]+\]\s*$/, "") : null);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const j of freshness.stalled) {
    if (j.billing) {
      // Деньги одного провайдера — одна строка на все его задачи.
      if (seen.has(j.billing)) continue;
      seen.add(j.billing);
      const mine = freshness.stalled.filter((x) => x.billing === j.billing);
      const error = clean(mine[0].lastError);
      const why = [BILLING_REASON, `задачи: ${mine.map((x) => x.label).join("; ")}`, error ? `ошибка: ${error.slice(0, 100)}` : null].filter(Boolean).join("; ");
      lines.push(`• ${escapeTelegramHtml(PROVIDER_LABEL[j.billing])} — ${escapeTelegramHtml(why)}`);
      continue;
    }
    const error = clean(j.lastError);
    const why = [j.reason, error ? `ошибка: ${error.slice(0, 100)}` : null].filter(Boolean).join("; ");
    lines.push(`• ${escapeTelegramHtml(j.label)} — ${escapeTelegramHtml(why)}`);
  }
  return `🚨 <b>Движок тенденций: задачи остановились (${freshness.stalled.length})</b>\n${lines.join("\n")}\n${JOBS_STALL_ACTION}`;
}

export function jobsRecoveredTelegram(): string {
  return "✅ <b>Задачи движка тенденций снова работают</b>\nСпрос WB, признаки по фото, рилсы и выборки Bright Data идут по расписанию.";
}
