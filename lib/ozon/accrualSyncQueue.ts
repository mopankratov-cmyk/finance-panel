/**
 * Один прогон крона тянет ровно один кабинет (см. app/api/sync/opiu-report и
 * app/api/sync/ozon-adverts — тот же принцип: не запускать все кабинеты
 * параллельно). Выбираем того, кого дольше всех не трогали — тот же приём,
 * что selectOzonAdSyncCabinets в lib/ozon/adSyncPlan.ts, но возвращает один
 * id вместо списка, как selectOpiuReportQueueCabinet.
 */
export interface OzonAccrualQueueState {
  cabinetId: string;
  status: string;
  updatedAt: string | null;
}

export function selectOzonAccrualQueueCabinet(
  cabinetIds: readonly string[],
  states: readonly OzonAccrualQueueState[],
): string | null {
  const uniqueIds = [...new Set(cabinetIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const byCabinet = new Map(states.map((state) => [state.cabinetId, state]));
  const ranked = uniqueIds.map((cabinetId, index) => {
    const updatedAt = Date.parse(byCabinet.get(cabinetId)?.updatedAt ?? "");
    return { cabinetId, index, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
  });

  ranked.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
  return ranked[0]?.cabinetId ?? null;
}
