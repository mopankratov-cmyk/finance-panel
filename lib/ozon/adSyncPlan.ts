export interface OzonAdSyncPlanCabinet {
  id: string;
  name: string;
  client_id: string;
}

export interface OzonAdSyncWarningNoteResult {
  cabinet: string;
  ok: boolean;
  partial: boolean;
  deferred: boolean;
  error: string | null;
}

/**
 * cacheUpdatedByClientId (ozon_ad_cache.updated_at) пишется ТОЛЬКО при
 * полностью успешном цикле — любой постоянно падающий кабинет (например, без
 * ключей Performance API) навсегда имеет здесь "никогда", то есть ранг 0,
 * старше любого реального времени. При limit=1 (обычный часовой тик) такой
 * кабинет выигрывал бы сортировку КАЖДЫЙ раз бесконечно, а остальные Ozon-
 * кабинеты не получали бы ни одного тика, пока он числится активным.
 *
 * lastAttemptByClientId (wb_sync_state.updated_at для job="ozon-adverts")
 * пишется на КАЖДОМ пути — и успех, и catch (writeWbSyncState всегда
 * проставляет updated_at=now()). Берём максимум из двух источников: реальная
 * дата последнего успеха, если она свежее последней попытки, иначе — сама
 * попытка. Это ломает бесконечную монополию постоянно падающего кабинета
 * (после первой неудачи его ранг уже не 0, а "только что"), не трогая
 * порядок для кабинетов, которые синкаются нормально.
 */
export function selectOzonAdSyncCabinets<T extends OzonAdSyncPlanCabinet>(
  cabinets: readonly T[],
  cacheUpdatedByClientId: ReadonlyMap<string, string | null>,
  limit = 1,
  lastAttemptByClientId: ReadonlyMap<string, string | null> = new Map(),
): T[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const rankOf = (clientId: string): number => {
    const cacheTime = Date.parse(cacheUpdatedByClientId.get(clientId) ?? "");
    const attemptTime = Date.parse(lastAttemptByClientId.get(clientId) ?? "");
    const cacheRank = Number.isFinite(cacheTime) ? cacheTime : 0;
    const attemptRank = Number.isFinite(attemptTime) ? attemptTime : 0;
    return Math.max(cacheRank, attemptRank);
  };
  return [...cabinets]
    .sort((left, right) => {
      const leftRank = rankOf(left.client_id);
      const rightRank = rankOf(right.client_id);
      return leftRank - rightRank || left.name.localeCompare(right.name, "ru");
    })
    .slice(0, safeLimit);
}

export function buildOzonAdSyncWarningNotes(results: readonly OzonAdSyncWarningNoteResult[]): string[] {
  const deferred = results.filter((result) => !result.ok && result.deferred);
  const failures = results.filter((result) => !result.ok && !result.deferred);
  const partial = results.filter((result) => result.partial).map((result) => result.cabinet);
  return [
    ...failures.map((result) => `${result.cabinet}: ${result.error ?? "unknown error"}`),
    ...deferred.map((result) => `${result.cabinet}: Ozon Performance готовит отчёт или ограничил частоту, повторим автоматически (${result.error ?? "retry later"})`),
    ...results.filter((result) => result.ok && result.error).map((result) => `${result.cabinet}: ${result.error}`),
    ...(partial.length ? [`Частичный Performance-отчёт: ${partial.join(", ")}`] : []),
  ];
}
