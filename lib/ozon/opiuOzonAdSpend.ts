import { isOzonAdCabinetTotalSku, isOzonAdServiceSku } from "@/lib/ozon/adDailyMarkers";

export interface OzonAdDailyInput {
  client_id: string;
  sku: string;
  date: string;
  spent: number;
}

function addTo(store: Map<string, Map<string, number>>, clientId: string, day: string, amount: number): void {
  const perClient = store.get(clientId) ?? new Map<string, number>();
  perClient.set(day, (perClient.get(day) ?? 0) + amount);
  store.set(clientId, perClient);
}

/**
 * Итог по кабинету за день Ozon отдаёт готовым (строка с sku='*',
 * OZON_AD_CABINET_TOTAL_SKU) — быстро и всегда доступно. Разнесение по
 * товарам едет отдельными асинхронными отчётами и может ещё не доехать.
 * Наивная сумма всех строк с sku='*' по всем кабинетам сразу — тот же баг,
 * что чинили раньше в app/api/ozon/ad-journal/route.ts: если у одного
 * кабинета есть готовый итог, а у другого пока только разнесение по товарам,
 * общий выбор "все через '*', или все через SKU" целиком теряет вклад
 * второго. Источник выбирается независимо для каждой пары (кабинет, день).
 */
export function sumOzonAdSpend(rows: OzonAdDailyInput[]): number {
  const cabinetTotals = new Map<string, Map<string, number>>();
  const skuTotals = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const clientId = row.client_id;
    const day = row.date.slice(0, 10);
    if (isOzonAdCabinetTotalSku(row.sku)) {
      addTo(cabinetTotals, clientId, day, row.spent);
      continue;
    }
    if (isOzonAdServiceSku(row.sku)) continue;
    addTo(skuTotals, clientId, day, row.spent);
  }

  const pairs = new Set<string>();
  for (const [clientId, days] of cabinetTotals) {
    for (const day of days.keys()) pairs.add(`${clientId}\u0000${day}`);
  }
  for (const [clientId, days] of skuTotals) {
    for (const day of days.keys()) pairs.add(`${clientId}\u0000${day}`);
  }

  let total = 0;
  for (const pair of pairs) {
    const [clientId, day] = pair.split("\u0000");
    const known = cabinetTotals.get(clientId)?.get(day);
    total += known ?? skuTotals.get(clientId)?.get(day) ?? 0;
  }
  return total;
}
