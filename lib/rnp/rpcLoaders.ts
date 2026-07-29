import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export interface RnpReportRow {
  nm_id: number;
  article: string;
  orders_today: number;
  orders_sum_today: number;
  orders_yesterday: number;
  orders_sum_yesterday: number;
  orders_week: number;
  orders_sum_week: number;
  orders_month: number;
  orders_sum_month: number;
  buyouts_today: number;
  buyouts_sum_today: number;
  buyouts_yesterday: number;
  buyouts_sum_yesterday: number;
  buyouts_week: number;
  buyouts_sum_week: number;
  buyouts_month: number;
  buyouts_sum_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number | null;
}

export interface RnpDailySkuRow {
  d: string;
  nm_id: number;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  buyouts_sum: number;
  ad_spent: number;
}

function normalizeAllowedNmIds(allowedNmIds?: ReadonlySet<number> | readonly number[] | null) {
  if (!allowedNmIds) return null;
  return Array.isArray(allowedNmIds) ? [...allowedNmIds] : [...allowedNmIds];
}

/**
 * PostgREST limits RPC responses to one page unless the caller ranges through
 * them. Use this for every user-facing rnp_report consumer instead of db.rpc().
 */
export async function loadRnpReportRows<Row extends { nm_id: number } = RnpReportRow>(
  db: SupabaseClient,
  cabinetId: string | null,
  options: {
    allowedNmIds?: ReadonlySet<number> | readonly number[] | null;
    label?: string;
    maxPages?: number;
  } = {},
): Promise<Row[]> {
  const allowed = normalizeAllowedNmIds(options.allowedNmIds);
  return loadAllSupabasePages<Row>((from, to) => {
    let query = db
      .rpc("rnp_report", { p_cabinet: cabinetId })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (allowed) query = query.in("nm_id", allowed.length ? allowed : [-1]);
    return query;
  }, { label: options.label ?? "RNP: товары", maxPages: options.maxPages ?? 100 });
}

/**
 * Safe paged loader for per-day/per-SKU RNP rows. A direct db.rpc() silently
 * returns only the first 1,000 rows on large all-cabinet ranges.
 */
export async function loadRnpDailySkuRows<Row extends { d: string; nm_id: number } = RnpDailySkuRow>(
  db: SupabaseClient,
  input: {
    from: string;
    to: string;
    cabinetId: string | null;
    allowedNmIds?: ReadonlySet<number> | readonly number[] | null;
    label?: string;
    maxPages?: number;
  },
): Promise<Row[]> {
  const allowed = normalizeAllowedNmIds(input.allowedNmIds);
  return loadAllSupabasePages<Row>((from, to) => {
    let query = db
      .rpc("rnp_daily_sku", { p_from: input.from, p_to: input.to, p_cabinet: input.cabinetId })
      .order("d", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (allowed) query = query.in("nm_id", allowed.length ? allowed : [-1]);
    return query;
  }, { label: input.label ?? "RNP: заказы по SKU", maxPages: input.maxPages ?? 100 });
}
