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
import { RU_SHOPS } from "./ruShops";
import { ZALANDO_SOURCES } from "./zalando";

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
  /** Паспорт: по нему Shopify-источник, подключённый после таблицы расписаний, тоже под присмотром. */
  accessStatus?: string | null;
  accessNote?: string | null;
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
export function isWatched(sourceId: string, hint?: { accessStatus?: string | null; accessNote?: string | null }): boolean {
  return hasScheduledCollector(sourceId, hint) && !WATCH_EXCLUDED.has(sourceId);
}

export function sourceFreshness(fact: SourceFact, nowMs = Date.now()): SourceFreshness {
  const base = { sourceId: fact.sourceId, name: fact.name, lastSuccessAt: fact.lastSuccessAt, lastError: fact.lastError };
  if (fact.lastSuccessAt) {
    const silentMs = nowMs - new Date(fact.lastSuccessAt).getTime();
    return { ...base, state: silentMs > staleAfterMs(fact.sourceId, fact) ? "stalled" : "ok", silentDays: Math.floor(silentMs / DAY_MS) };
  }
  // Успешных сборов не было. Пытался и получал ошибку — не работает; не пытался вовсе — судить рано.
  return { ...base, state: fact.lastAttemptAt && fact.lastError ? "stalled" : "awaiting", silentDays: null };
}

// ---------------------------------------------------------------------------
// Mac mini: загрузчик сайтов РФ и Zalando и отпечатки фото (CLIP) живут на одной машине

/** Отпечатки фото (CLIP на Mac mini) — псевдо-источник сторожа: у них нет строки паспорта, пульс — время последнего отпечатка. */
export const CLIP_SOURCE_ID = "CLIP";
export const CLIP_NAME = "Отпечатки фото (CLIP на Mac mini)";
/** Сколько часов очередь отпечатков может ждать без единого нового отпечатка (сборщик ходит раз в 15 минут) — дольше это простой. */
export const CLIP_STALE_HOURS = 24;

/** Всё, что приносит Mac mini: магазины РФ «через mini», Zalando и отпечатки фото. Простой mini глушит их разом. */
export const MINI_SOURCE_IDS: ReadonlySet<string> = new Set([
  ...RU_SHOPS.filter((shop) => shop.via === "mini").map((shop) => shop.sourceId),
  ...ZALANDO_SOURCES.map((source) => source.sourceId),
  CLIP_SOURCE_ID,
]);

/** Пульс отпечатков: когда записан последний (с ошибкой фото — тоже: mini жив) и с какого времени ждёт самое старое фото очереди. */
export interface ClipPulse {
  lastEmbeddingAt: string | null;
  /** null — очередь пуста: молчать mini есть о чём, только когда фото ждут. */
  oldestWaitingAt: string | null;
}

/**
 * Отпечатки молчат: фото в очереди ждут дольше CLIP_STALE_HOURS, а нового отпечатка за это время не было. Пустая очередь — не простой
 * (считать нечего); свежее фото в очереди при давнем последнем отпечатке — ещё не простой (сборщик возьмёт его в ближайшие 15 минут).
 */
export function clipFreshness(pulse: ClipPulse, nowMs = Date.now()): SourceFreshness {
  const staleMs = CLIP_STALE_HOURS * 3600 * 1000;
  const last = pulse.lastEmbeddingAt ? Date.parse(pulse.lastEmbeddingAt) : null;
  const base = { sourceId: CLIP_SOURCE_ID, name: CLIP_NAME, lastSuccessAt: pulse.lastEmbeddingAt, silentDays: last !== null ? Math.floor((nowMs - last) / DAY_MS) : null };
  if (!pulse.oldestWaitingAt) return { ...base, state: last !== null ? "ok" : "awaiting", lastError: null };
  const waitingLong = nowMs - Date.parse(pulse.oldestWaitingAt) > staleMs;
  const quiet = last === null || nowMs - last > staleMs;
  return waitingLong && quiet
    ? { ...base, state: "stalled", lastError: `фото ждут отпечатка с ${day(pulse.oldestWaitingAt)}` }
    : { ...base, state: "ok", lastError: null };
}

export function assortmentFreshness(facts: SourceFact[], nowMs = Date.now(), clip: ClipPulse | null = null): AssortmentFreshness {
  const sources = [
    ...facts.filter((f) => isWatched(f.sourceId, f)).map((f) => sourceFreshness(f, nowMs)),
    ...(clip ? [clipFreshness(clip, nowMs)] : []),
  ].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const stalled = sources.filter((s) => s.state === "stalled");
  return { state: stalled.length ? "stalled" : "ok", stalled, sources };
}

/** Чем молчание отличается для ключа тревоги: всё, что приносит mini, — одна причина («mini»), остальное — источником. */
export function alertIdentity(sourceId: string): string {
  return MINI_SOURCE_IDS.has(sourceId) ? "mini" : sourceId;
}

/**
 * Ключ тревоги = префикс + набор молчаний. Пока набор тот же —
 * повторов нет; замолчал ещё один (или заговорил один из них) — новый ключ и
 * новое сообщение. Всё, что приносит Mac mini, — одно молчание: при простое mini
 * магазины РФ, Zalando и отпечатки замолкают по очереди (у каждого свой порог),
 * и раньше каждый новый молчун давал новое сообщение — за один простой поток.
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
    const openKey = `${ASSORTMENT_ALERT_PREFIX}${[...new Set(freshness.stalled.map((s) => alertIdentity(s.sourceId)))].sort().join(",")}`;
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

export const ASSORTMENT_STALL_ACTION = "Откройте «Разработка ассортимента → Источники»: там видно, какой сборщик молчит. Если молчит Mac mini (магазины РФ, Zalando, отпечатки фото) — проверьте, что он включён и загрузчик с отпечатками запущены (LaunchAgent'ы com.financepanel.assortment-*); если Bright Data — баланс.";

/** Текст тревоги для `finance_alerts.message`, без разметки. */
export function assortmentStallMessage(freshness: AssortmentFreshness): string {
  const names = freshness.stalled.map((s) => s.name).join(", ");
  return `Молчат сборщики ассортимента (${freshness.stalled.length}): ${names}`;
}

/** Всё, что приносит mini, — одной строкой: если молчат разом, это простой машины, а не поломка каждого сайта. */
function miniLine(list: SourceFreshness[]): string {
  const items = list.map((s) => {
    const since = s.lastSuccessAt ? `с ${day(s.lastSuccessAt)}` : "успешных не было";
    return `${s.name} (${since}${s.lastError ? `; ${s.lastError.slice(0, 60)}` : ""})`;
  });
  return `• ${escapeTelegramHtml(`Mac mini — молчат ${list.length}: ${items.join("; ")}`)}`;
}

export function assortmentStallTelegram(freshness: AssortmentFreshness): string {
  const mini = freshness.stalled.filter((s) => MINI_SOURCE_IDS.has(s.sourceId));
  const lines = [...(mini.length ? [miniLine(mini)] : []), ...freshness.stalled.filter((s) => !MINI_SOURCE_IDS.has(s.sourceId)).map(line)];
  const listed = lines.slice(0, MAX_LISTED).join("\n");
  const more = lines.length > MAX_LISTED ? `\n…и ещё ${lines.length - MAX_LISTED}` : "";
  return `🚨 <b>Сбор ассортимента: молчат источники (${freshness.stalled.length})</b>\n${listed}${more}\n${ASSORTMENT_STALL_ACTION}`;
}

export function assortmentRecoveredTelegram(): string {
  return "✅ <b>Сбор ассортимента снова идёт</b>\nВсе отслеживаемые источники собирают по расписанию.";
}
