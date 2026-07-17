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

export function selectOzonAdSyncCabinets<T extends OzonAdSyncPlanCabinet>(
  cabinets: readonly T[],
  cacheUpdatedByClientId: ReadonlyMap<string, string | null>,
  limit = 1,
): T[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return [...cabinets]
    .sort((left, right) => {
      const leftTime = Date.parse(cacheUpdatedByClientId.get(left.client_id) ?? "");
      const rightTime = Date.parse(cacheUpdatedByClientId.get(right.client_id) ?? "");
      const leftRank = Number.isFinite(leftTime) ? leftTime : 0;
      const rightRank = Number.isFinite(rightTime) ? rightTime : 0;
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
