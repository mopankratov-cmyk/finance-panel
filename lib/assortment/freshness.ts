/**
 * Сторож сборщиков ассортимента (`/api/sync/assortment-freshness`).
 *
 * Сборщик полок девять дней не доставлял снимки, пока это не заметили руками:
 * о своих отказах он писал только в свой лог. У сборщиков ассортимента та же
 * слепота — упал загрузчик на mini, кончился баланс Bright Data, сайт сменил
 * разметку и отдаёт ноль карточек — на экране это краснеет только через двое
 * суток, а в Telegram приходит раз в неделю в воскресной сводке.
 *
 * Здесь решается, молчит ли источник: последний УСПЕШНЫЙ сбор (last_success_at
 * ставится, только если что-то собрано — ноль карточек при «успехе» тоже
 * молчание) старше порога по расписанию источника. Чистые функции: правило
 * «один простой — одно сообщение, восстановление — второе» проверяется тестом.
 */

import { hasScheduledCollector, staleAfterMs } from "./collectorSchedule";

/**
 * Источники, которые код обходит, но сторожить не нужно: S129 («Lime на
 * Wildberries») — у бренда на WB нет продаж, собирать там нечего по построению.
 */
export const WATCH_EXCLUDED: ReadonlySet<string> = new Set(["S129"]);

export interface SourceFact {
  sourceId: string;
  name: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/** ok — собирает; stalled — молчит дольше порога или не работал вовсе; awaiting — ещё нечего судить. */
export type SourceState = "ok" | "stalled" | "awaiting";

export interface SourceFreshness {
  sourceId: string;
  name: string;
  state: SourceState;
  lastSuccessAt: string | null;
  /** Сколько суток нет успешного сбора; null — не было ни одного. */
  silentDays: number | null;
  lastError: string | null;
}

export interface AssortmentFreshness {
  state: "ok" | "stalled";
  stalled: SourceFreshness[];
  sources: SourceFreshness[];
}

const DAY_MS = 24 * 3600 * 1000;

/** Только источники с настоящим сборщиком и не из исключений. */
export function isWatched(sourceId: string): boolean {
  return hasScheduledCollector(sourceId) && !WATCH_EXCLUDED.has(sourceId);
}

export function sourceFreshness(fact: SourceFact, nowMs = Date.now()): SourceFreshness {
  const base = { sourceId: fact.sourceId, name: fact.name, lastSuccessAt: fact.lastSuccessAt, lastError: fact.lastError };
  if (fact.lastSuccessAt) {
    const silentMs = nowMs - new Date(fact.lastSuccessAt).getTime();
    return { ...base, state: silentMs > staleAfterMs(fact.sourceId) ? "stalled" : "ok", silentDays: Math.floor(silentMs / DAY_MS) };
  }
  // Успешных сборов не было. Пытался и получал ошибку — не работает; не пытался вовсе — судить рано.
  return { ...base, state: fact.lastAttemptAt && fact.lastError ? "stalled" : "awaiting", silentDays: null };
}

export function assortmentFreshness(facts: SourceFact[], nowMs = Date.now()): AssortmentFreshness {
  const sources = facts.filter((f) => isWatched(f.sourceId)).map((f) => sourceFreshness(f, nowMs)).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const stalled = sources.filter((s) => s.state === "stalled");
  return { state: stalled.length ? "stalled" : "ok", stalled, sources };
}

/**
 * Ключ тревоги = префикс + набор молчащих источников. Пока набор тот же —
 * повторов нет; замолчал ещё один (или заговорил один из них) — новый ключ и
 * новое сообщение.
 */
export const ASSORTMENT_ALERT_PREFIX = "assortment-collectors-stalled:";

export interface AssortmentAlertPlan {
  send: "stalled" | "recovered" | null;
  openKey: string | null;
  resolveKeys: string[];
}

export function assortmentAlertPlan(freshness: AssortmentFreshness, openKeys: string[]): AssortmentAlertPlan {
  const ours = openKeys.filter((key) => key.startsWith(ASSORTMENT_ALERT_PREFIX));
  if (freshness.state === "stalled") {
    const openKey = `${ASSORTMENT_ALERT_PREFIX}${freshness.stalled.map((s) => s.sourceId).sort().join(",")}`;
    return {
      send: ours.includes(openKey) ? null : "stalled",
      openKey,
      // Прежний набор молчунов сменился новым — старая тревога закрывается молча: о новой сообщение уходит и так.
      resolveKeys: ours.filter((key) => key !== openKey),
    };
  }
  return { send: ours.length ? "recovered" : null, openKey: null, resolveKeys: ours };
}

/** В тексте для Telegram (parse_mode HTML) названия вроде «H&M» и «Pull&Bear» нужно экранировать. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_LISTED = 10;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
}

function line(s: SourceFreshness): string {
  const since = s.lastSuccessAt ? `последний успешный сбор ${day(s.lastSuccessAt)}${s.silentDays != null ? ` (${s.silentDays} сут назад)` : ""}` : "успешных сборов не было";
  const why = s.lastError ? `; ошибка: ${s.lastError.slice(0, 80)}` : "";
  return `• ${escapeTelegramHtml(s.name)} — ${escapeTelegramHtml(since + why)}`;
}

export const ASSORTMENT_STALL_ACTION = "Откройте «Разработка ассортимента → Источники»: там видно, какой сборщик молчит. Если молчит загрузчик на Mac mini — проверьте, что он запущен; если Bright Data — баланс.";

/** Текст тревоги для `finance_alerts.message`, без разметки. */
export function assortmentStallMessage(freshness: AssortmentFreshness): string {
  const names = freshness.stalled.map((s) => s.name).join(", ");
  return `Молчат сборщики ассортимента (${freshness.stalled.length}): ${names}`;
}

export function assortmentStallTelegram(freshness: AssortmentFreshness): string {
  const listed = freshness.stalled.slice(0, MAX_LISTED).map(line).join("\n");
  const more = freshness.stalled.length > MAX_LISTED ? `\n…и ещё ${freshness.stalled.length - MAX_LISTED}` : "";
  return `🚨 <b>Сбор ассортимента: молчат источники (${freshness.stalled.length})</b>\n${listed}${more}\n${ASSORTMENT_STALL_ACTION}`;
}

export function assortmentRecoveredTelegram(): string {
  return "✅ <b>Сбор ассортимента снова идёт</b>\nВсе отслеживаемые источники собирают по расписанию.";
}
