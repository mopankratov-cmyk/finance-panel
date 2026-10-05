import type { RunCoverage } from "./observationLog";

/**
 * «Состояние данных» (движок тенденций, этап 1): сколько истории наблюдений
 * накоплено по каждому источнику и чему на ней уже можно верить. Чистые функции.
 *
 * История копится с первого прогона после выкладки слоя наблюдений и не
 * наверстывается задним числом, поэтому экран прямо говорит, что пока можно, а
 * чего нет: до первых двух полных прогонов «появилось/пропало» — не факт, а до
 * четырёх недель наблюдений слово «тенденция» не по чему применять.
 */

export interface RunRow {
  source_id: string;
  direction: string | null;
  observed_on: string;
  coverage: RunCoverage;
  seen: number;
  added: number;
  error: string | null;
  started_at: string;
}

/** Сколько дней между первым и последним полным прогоном, чтобы судить о появлении и пропаже. */
export const APPEARANCE_MIN_SPAN_DAYS = 7;
/** Глубина наблюдений, с которой можно говорить о динамике. */
export const DYNAMICS_MIN_SPAN_DAYS = 28;
export const DYNAMICS_MIN_DAYS = 4;

export type HistoryStatus =
  /** Прогонов не было. */
  | "none"
  /** Есть наблюдения, но полных прогонов мало или они слишком близки по времени. */
  | "building"
  /** Источник отдаёт только верх выдачи: «новинка» = впервые попало в окно. */
  | "window_only"
  /** Два полных прогона с разрывом ≥ 7 дней: «появилось/пропало» — наблюдение. */
  | "appearance"
  /** ≥ 4 недель и ≥ 4 дней наблюдений: можно смотреть динамику. */
  | "dynamics";

export interface SourceHistory {
  sourceId: string;
  runs: number;
  full: number;
  window: number;
  partial: number;
  /** Дней, в которые был хотя бы один прогон. */
  days: number;
  firstDay: string | null;
  lastDay: string | null;
  /** Дней между первым наблюдением и сегодня. */
  spanDays: number;
  lastFullOn: string | null;
  /** Первый день с ПОЛНЫМ прогоном: от него считается «появилось/пропало» (firstDay — первый прогон любого покрытия). */
  firstFullDay: string | null;
  /** Сколько товаров увидел последний прогон. */
  lastSeen: number | null;
  /** Ошибка последнего прогона, если он оборвался. */
  lastError: string | null;
  status: HistoryStatus;
}

const DAY_MS = 24 * 3600 * 1000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function summarizeHistory(rows: RunRow[], today: string): SourceHistory[] {
  const bySource = new Map<string, RunRow[]>();
  for (const row of rows) {
    const list = bySource.get(row.source_id) ?? [];
    list.push(row);
    bySource.set(row.source_id, list);
  }
  const out: SourceHistory[] = [];
  for (const [sourceId, list] of bySource) {
    const sorted = list.slice().sort((a, b) => a.started_at.localeCompare(b.started_at));
    const days = new Set(sorted.map((r) => r.observed_on));
    const fullDays = [...new Set(sorted.filter((r) => r.coverage === "full").map((r) => r.observed_on))].sort();
    const dayList = [...days].sort();
    const latest = sorted[sorted.length - 1];
    const firstDay = dayList[0] ?? null;
    const spanDays = firstDay ? Math.max(0, daysBetween(firstDay, today)) : 0;
    const fullSpan = fullDays.length >= 2 ? daysBetween(fullDays[0], fullDays[fullDays.length - 1]) : 0;
    const onlyWindow = sorted.every((r) => r.coverage === "window");

    let status: HistoryStatus = "building";
    if (sorted.length === 0) status = "none";
    else if (onlyWindow) status = "window_only";
    else if (fullDays.length >= 2 && fullSpan >= APPEARANCE_MIN_SPAN_DAYS) {
      status = dayList.length >= DYNAMICS_MIN_DAYS && daysBetween(dayList[0], dayList[dayList.length - 1]) >= DYNAMICS_MIN_SPAN_DAYS ? "dynamics" : "appearance";
    }
    out.push({
      sourceId,
      runs: sorted.length,
      full: sorted.filter((r) => r.coverage === "full").length,
      window: sorted.filter((r) => r.coverage === "window").length,
      partial: sorted.filter((r) => r.coverage === "partial").length,
      days: days.size,
      firstDay,
      lastDay: dayList[dayList.length - 1] ?? null,
      spanDays,
      lastFullOn: fullDays[fullDays.length - 1] ?? null,
      firstFullDay: fullDays[0] ?? null,
      lastSeen: latest ? latest.seen : null,
      lastError: latest?.coverage === "partial" ? latest.error : null,
      status,
    });
  }
  return out.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

/**
 * Журнал прогонов общий для разделов, а экран «Источники» показывает источники одного раздела: чужие строки (с сырыми ключами вроде
 * S212 вместо названий) не показываем. Известных источников нет (список ещё не загрузился) — не режем.
 */
export function onlyKnownSources<T extends { sourceId: string }>(rows: T[], known: ReadonlySet<string>): T[] {
  return known.size === 0 ? rows : rows.filter((row) => known.has(row.sourceId));
}

export const HISTORY_STATUS_LABEL: Record<HistoryStatus, string> = {
  none: "Истории нет",
  building: "Копится",
  window_only: "Только верх выдачи",
  appearance: "Появилось / пропало — наблюдение",
  dynamics: "Можно смотреть динамику",
};

export const HISTORY_STATUS_HINT: Record<HistoryStatus, string> = {
  none: "Прогонов с журналом ещё не было.",
  building: `Нужно два полных прогона с разрывом от ${APPEARANCE_MIN_SPAN_DAYS} дней, чтобы «появилось» и «пропало» стали наблюдением.`,
  window_only: "Источник отдаёт только верх выдачи: «новинка» значит «впервые попало в окно», а не «впервые появилось на сайте»; пропажу по нему не определить.",
  appearance: `«Появилось» и «пропало» — наблюдение. Динамика — от ${DYNAMICS_MIN_SPAN_DAYS} дней и ${DYNAMICS_MIN_DAYS} дней наблюдений.`,
  dynamics: "Накоплено достаточно, чтобы смотреть, как менялся ассортимент, но не чтобы предсказывать.",
};
