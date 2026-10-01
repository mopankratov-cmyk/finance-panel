/**
 * Решения сторожа «Полок» (`/api/sync/shelf-freshness`): о чём писать в Telegram
 * и какие тревоги держать открытыми в `finance_alerts`. Чистая функция — чтобы
 * правило «один простой — одно сообщение, восстановление — второе» проверялось
 * тестом, а не живым ботом.
 */

import {
  formatMsk,
  SHELF_STALL_ACTION,
  shelfLastSnapshotLabel,
  shelfStallSummary,
  type ShelfFreshness,
} from "@/lib/shelf/freshness";

/**
 * Ключ тревоги = префикс + время последнего принятого снимка. Пока простой
 * длится, снимок тот же — и ключ тот же, повторов нет; новый простой после
 * нового снимка — новый ключ и новое сообщение.
 */
export const SHELF_ALERT_PREFIX = "shelf-collector-stalled:";

export interface ShelfAlertPlan {
  /** Сообщение в Telegram: о застое, о восстановлении или никакого. */
  send: "stalled" | "recovered" | null;
  /** Тревога, которую держать открытой (ставится ПОСЛЕ успешной отправки). */
  openKey: string | null;
  /** Открытые тревоги, которые закрыть. */
  resolveKeys: string[];
  /** После какого снимка начался закончившийся простой — для сообщения о восстановлении. */
  stalledAfter: string | null;
}

export function shelfAlertPlan(freshness: ShelfFreshness, openKeys: string[]): ShelfAlertPlan {
  const ours = openKeys.filter((key) => key.startsWith(SHELF_ALERT_PREFIX));
  if (freshness.state === "stalled") {
    const openKey = `${SHELF_ALERT_PREFIX}${freshness.lastIngestAt ?? freshness.lastCollectedAt}`;
    return {
      send: ours.includes(openKey) ? null : "stalled",
      openKey,
      // Прошлый простой, который закончился и сменился новым между прогонами,
      // закрывается молча: о новом сообщение уходит и так.
      resolveKeys: ours.filter((key) => key !== openKey),
      stalledAfter: null,
    };
  }
  const stalledAfter = ours
    .map((key) => key.slice(SHELF_ALERT_PREFIX.length))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0] ?? null;
  return {
    // «Снова идёт» — только когда снимки правда пошли. Если отслеживать стало
    // нечего (idle) или снимков нет вовсе (awaiting), тревога закрывается молча.
    send: ours.length && freshness.state === "ok" ? "recovered" : null,
    openKey: null,
    resolveKeys: ours,
    stalledAfter,
  };
}

function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Текст тревоги для `finance_alerts.message`, без разметки. */
export function shelfStallMessage(freshness: ShelfFreshness, nowMs = Date.now()): string {
  return sentence(shelfStallSummary(freshness, nowMs));
}

/** Сообщения в Telegram (parse_mode HTML; в тексте нет `<`, `>` и `&`). */
export function shelfStallTelegram(freshness: ShelfFreshness, nowMs = Date.now()): string {
  return `🚨 <b>Сбор «Полок» встал</b>\n${shelfStallMessage(freshness, nowMs)}\n${SHELF_STALL_ACTION}`;
}

export function shelfRecoveredTelegram(freshness: ShelfFreshness, stalledAfter: string | null, nowMs = Date.now()): string {
  const since = stalledAfter ? ` Простой начался после снимка ${formatMsk(stalledAfter)} МСК.` : "";
  return `✅ <b>Сбор «Полок» снова идёт</b>\nПоследний снимок ${shelfLastSnapshotLabel(freshness, nowMs) ?? "—"}.${since}`;
}
