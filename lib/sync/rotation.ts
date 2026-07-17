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
