export function rotatingSyncTargets<T extends { id: string }>(
  values: readonly T[],
  options: { requestedId?: string | null; runAll?: boolean; nowMs?: number; slotMs?: number } = {},
): T[] {
  if (options.requestedId) return values.filter((value) => value.id === options.requestedId);
  if (options.runAll || values.length <= 1) return [...values];
  const slotMs = Math.max(60_000, Math.floor(options.slotMs ?? 60 * 60 * 1_000));
  const slot = Math.floor((options.nowMs ?? Date.now()) / slotMs);
  return [values[((slot % values.length) + values.length) % values.length]!];
}

export function stalestSyncTargets<T extends { id: string }>(
  values: readonly T[],
  syncedAtById: ReadonlyMap<string, string | null | undefined>,
  limit = 1,
): T[] {
  return [...values]
    .sort((left, right) => {
      const leftMs = Date.parse(syncedAtById.get(left.id) ?? "");
      const rightMs = Date.parse(syncedAtById.get(right.id) ?? "");
      const leftTime = Number.isFinite(leftMs) ? leftMs : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(rightMs) ? rightMs : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    })
    .slice(0, Math.max(0, Math.floor(limit)));
}
