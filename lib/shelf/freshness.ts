/**
 * Свежесть «Полок» по плановым слотам сборщика.
 *
 * Сборщик живёт на Mac mini (launchd будит его раз в 15 минут) и снимает полки
 * в три слота по Москве. Об отказах он пишет только в свой лог: с 21.09 по
 * 01.10.2026 он не мог достучаться до панели (vercel.app из РФ режется, узел VPN
 * на mini умер), 907 падений подряд и ни одного снимка — в панели этого не было
 * видно, заметили через девять дней.
 *
 * Возраст в часах для полок — плохая мера: штатная ночная пауза 22:00→10:00
 * уже 12 часов, и порог «сутки» срабатывал только после второго пропуска.
 * Поэтому считаем сами слоты: слот пропущен, если после его начала панель не
 * приняла ни одного снимка, а запас на сбор уже вышел.
 *
 * Чистые функции — их читают и сервер, и экран. Чтение базы —
 * `lib/shelf/freshnessFacts.ts`.
 */

import { collectorAgeLabel } from "@/lib/collectorFreshness";
import { plural } from "@/lib/warehouse/plural";

/**
 * Плановые слоты, часы по Москве. Зеркало `SLOTS` в
 * `~/shelf-collector/src/schedule.js` на mini — меняются только вместе.
 */
export const SHELF_SLOT_HOURS_MSK = [10, 18, 22] as const;

/**
 * Запас на сам сбор. launchd будит сборщик раз в 15 минут, полный круг из 145
 * артикулов идёт 20–30 минут (01.10.2026: 08:24→08:41 и 15:12→15:30 UTC),
 * антибот-пауза добавляет по 3 минуты на блокировку. Два часа — с запасом на
 * медленный круг, но до следующего слота ещё далеко.
 */
export const SHELF_SLOT_GRACE_MINUTES = 120;

// Москва — UTC+3 круглый год с 2014 года, переходов нет.
const MSK_OFFSET_MS = 3 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Начала плановых слотов в полуинтервале (afterMs, untilMs], по возрастанию. */
export function shelfSlotStartsBetween(afterMs: number, untilMs: number): number[] {
  const starts: number[] = [];
  if (!Number.isFinite(afterMs) || !Number.isFinite(untilMs) || untilMs <= afterMs) return starts;
  // Московская полночь того дня, в который попадает afterMs, — в UTC.
  for (let dayStart = Math.floor((afterMs + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS; dayStart <= untilMs; dayStart += DAY_MS) {
    for (const hour of SHELF_SLOT_HOURS_MSK) {
      const start = dayStart + hour * HOUR_MS;
      if (start > afterMs && start <= untilMs) starts.push(start);
    }
  }
  return starts;
}

/** Что известно из базы о снимках среза (кабинет или все кабинеты сразу). */
export interface ShelfFreshnessFacts {
  /** Активные отслеживания: есть они — от сборщика ждут снимков. */
  activeWatches: number;
  /** Самый свежий снимок по времени сбора на mini (`collected_at`). */
  lastCollectedAt: string | null;
  /** Когда панель последний раз приняла снимок (`created_at`) — успешный ingest. */
  lastIngestAt: string | null;
  /** Всего снимков в срезе. */
  snapshots: number;
}

/**
 * idle — отслеживать нечего, сборщику тут делать нечего;
 * awaiting — артикулы есть, снимков ещё не было ни одного (только что добавили
 *   или срез никогда не собирался) — это не застой;
 * ok — после последнего снимка ни один слот не пропущен;
 * stalled — пропущен хотя бы один слот с запасом.
 */
export type ShelfFreshnessState = "idle" | "awaiting" | "ok" | "stalled";

export interface ShelfFreshness {
  state: ShelfFreshnessState;
  lastCollectedAt: string | null;
  lastIngestAt: string | null;
  /** Слоты после последнего принятого снимка, у которых вышел запас на сбор. */
  missedSlots: number;
  /** С какого слота начался простой, ISO. */
  firstMissedSlotAt: string | null;
  /** Ближайший будущий слот, ISO. */
  nextSlotAt: string | null;
  activeWatches: number;
  snapshots: number;
}

function parseMs(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function toIso(ms: number): string | null {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function shelfFreshness(facts: ShelfFreshnessFacts, nowMs = Date.now()): ShelfFreshness {
  const nextSlotAt = toIso(shelfSlotStartsBetween(nowMs, nowMs + DAY_MS)[0] ?? Number.NaN);
  const base = {
    lastCollectedAt: toIso(parseMs(facts.lastCollectedAt)),
    lastIngestAt: toIso(parseMs(facts.lastIngestAt)),
    nextSlotAt,
    activeWatches: facts.activeWatches,
    snapshots: facts.snapshots,
  };
  // Опорная точка — самое позднее из «собрано» и «принято». Приём меряют часы
  // сервера: ушедшие часы mini не дают ложной тревоги, а дослать старые снимки
  // после простоя — это и есть «сборщик снова достаёт до панели».
  const lastMs = Math.max(...[facts.lastIngestAt, facts.lastCollectedAt].map(parseMs).filter(Number.isFinite));
  if (facts.activeWatches <= 0) return { ...base, state: "idle", missedSlots: 0, firstMissedSlotAt: null };
  if (!Number.isFinite(lastMs)) return { ...base, state: "awaiting", missedSlots: 0, firstMissedSlotAt: null };
  const missed = shelfSlotStartsBetween(lastMs, nowMs - SHELF_SLOT_GRACE_MINUTES * 60_000);
  return {
    ...base,
    state: missed.length > 0 ? "stalled" : "ok",
    missedSlots: missed.length,
    firstMissedSlotAt: toIso(missed[0] ?? Number.NaN),
  };
}

const MSK_DATE_TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const MSK_DATE = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
const MSK_TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });

/** «21.09, 22:35» по Москве. */
export function formatMsk(iso: string): string {
  return MSK_DATE_TIME.format(new Date(iso));
}

/** Для тесной карточки: «15:30», если это было сегодня по Москве, иначе «21.09». */
export function formatMskShort(iso: string, nowMs = Date.now()): string {
  const date = new Date(iso);
  return MSK_DATE.format(date) === MSK_DATE.format(new Date(nowMs)) ? MSK_TIME.format(date) : MSK_DATE.format(date);
}

/** «пропущен 1 слот», «пропущено 3 слота», «пропущено 27 слотов». */
export function missedSlotsLabel(count: number): string {
  return `${plural(count, "пропущен", "пропущено", "пропущено")} ${count} ${plural(count, "слот", "слота", "слотов")}`;
}

/** Последний снимок: «21.09, 22:35 МСК (10 дн назад)» или null, если снимков не было. */
export function shelfLastSnapshotLabel(freshness: ShelfFreshness, nowMs = Date.now()): string | null {
  const last = freshness.lastIngestAt ?? freshness.lastCollectedAt;
  if (!last) return null;
  return `${formatMsk(last)} МСК (${collectorAgeLabel(Math.max(0, (nowMs - Date.parse(last)) / 3_600_000))})`;
}

/**
 * Одна фраза о застое — общая для плашки «Полок», экранов здоровья и Telegram,
 * чтобы везде читалось одно и то же: «последний снимок 21.09, 22:35 МСК
 * (10 дн назад), пропущено 27 слотов начиная с 22.09, 10:00».
 */
export function shelfStallSummary(freshness: ShelfFreshness, nowMs = Date.now()): string {
  const last = shelfLastSnapshotLabel(freshness, nowMs);
  const since = freshness.firstMissedSlotAt ? ` начиная с ${formatMsk(freshness.firstMissedSlotAt)}` : "";
  return `последний снимок ${last ?? "—"}, ${missedSlotsLabel(freshness.missedSlots)}${since}`;
}

/** Что проверить человеку, когда сбор встал. */
export const SHELF_STALL_ACTION = "Снимки делает сборщик на Mac mini: проверьте, что машина в сети и у неё жив выход за границу (VPN) — без него панель на vercel.app из РФ недоступна.";
