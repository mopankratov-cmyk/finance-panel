export interface ScopedUnitPeriodRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  buyouts_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number;
}

export interface ScopedUnitDailyRow {
  d: string;
  nm_id: number;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  ad_spent: number;
}

export interface ScopedUnitReferenceRow {
  nm_id: number;
  article: string;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
}

export interface ScopedUnitCatalogRow {
  nm_id: number;
  article: string;
  cost: number | null;
}

/**
 * Rebuilds a scoped calendar report from the same paged RNP sources that feed
 * the working price calculator. Every allowed SKU stays in the result even
 * when it has no activity in the selected period.
 */
export function mergeScopedUnitPeriodRows(
  allowedNmIds: ReadonlySet<number>,
  dailyRows: readonly ScopedUnitDailyRow[],
  referenceRows: readonly ScopedUnitReferenceRow[],
  catalogRows: readonly ScopedUnitCatalogRow[],
): ScopedUnitPeriodRow[] {
  const dailyByNm = new Map<number, Omit<ScopedUnitPeriodRow, "article" | "stock" | "in_way_to_client" | "cost">>();
  for (const row of dailyRows) {
    const nmId = Number(row.nm_id);
    if (!allowedNmIds.has(nmId)) continue;
    const current = dailyByNm.get(nmId) ?? {
      nm_id: nmId,
      orders_month: 0,
      orders_sum_month: 0,
      buyouts_month: 0,
      ad_spend_month: 0,
    };
    current.orders_month += Number(row.orders_count ?? 0);
    current.orders_sum_month += Number(row.orders_sum ?? 0);
    current.buyouts_month += Number(row.buyouts_count ?? 0);
    current.ad_spend_month += Number(row.ad_spent ?? 0);
    dailyByNm.set(nmId, current);
  }

  const referenceByNm = new Map(
    referenceRows
      .filter((row) => allowedNmIds.has(Number(row.nm_id)))
      .map((row) => [Number(row.nm_id), row] as const),
  );
  const catalogByNm = new Map(
    catalogRows
      .filter((row) => allowedNmIds.has(Number(row.nm_id)))
      .map((row) => [Number(row.nm_id), row] as const),
  );

  return [...allowedNmIds].map((nmId) => {
    const daily = dailyByNm.get(nmId);
    const reference = referenceByNm.get(nmId);
    const catalog = catalogByNm.get(nmId);
    return {
      nm_id: nmId,
      article: reference?.article || catalog?.article || "",
      orders_month: daily?.orders_month ?? 0,
      orders_sum_month: daily?.orders_sum_month ?? 0,
      buyouts_month: daily?.buyouts_month ?? 0,
      stock: Number(reference?.stock ?? 0),
      in_way_to_client: Number(reference?.in_way_to_client ?? 0),
      cost: reference?.cost ?? catalog?.cost ?? null,
      ad_spend_month: daily?.ad_spend_month ?? 0,
    };
  });
}
