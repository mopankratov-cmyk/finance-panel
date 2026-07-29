import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import {
  funnelReadinessFingerprint,
  isFunnelSyncReady,
  type FunnelSyncStateRow,
} from "./funnelReadiness";
import type { FunnelOrderFact } from "./metrics";

interface QueryResult<Row> {
  data: Row | null;
  error: { message: string } | null;
}

interface StateQuery {
  select(columns: string): StateQuery;
  eq(column: string, value: string): StateQuery;
  maybeSingle(): PromiseLike<QueryResult<FunnelSyncStateRow>>;
}

interface FunnelPageQuery {
  select(columns: string): FunnelPageQuery;
  eq(column: string, value: string): FunnelPageQuery;
  gte(column: string, value: string): FunnelPageQuery;
  lte(column: string, value: string): FunnelPageQuery;
  order(column: string, options: { ascending: boolean }): FunnelPageQuery;
  range(from: number, to: number): PromiseLike<QueryResult<FunnelRow[]>>;
}

interface FunnelRow {
  cabinet_id: string;
  nm_id: number;
  date: string;
  orders: unknown;
  orders_sum: unknown;
}

export interface FunnelReadClient {
  from(relation: string): unknown;
}

type FunnelReadClock = () => Date;

async function queryFunnelState(
  client: FunnelReadClient,
  cabinetId: string,
): Promise<QueryResult<FunnelSyncStateRow>> {
  const stateQuery = client.from("wb_sync_state") as StateQuery;
  return stateQuery
    .select("cabinet_id, job, status, attempts, last_error, state, updated_at")
    .eq("cabinet_id", cabinetId)
    .eq("job", "funnel")
    .maybeSingle();
}

export async function loadReadyFunnelFacts(
  client: FunnelReadClient,
  cabinetId: string,
  dateFrom: string,
  dateTo: string,
  now: Date | FunnelReadClock = () => new Date(),
): Promise<FunnelOrderFact[]> {
  try {
    const stateResult = await queryFunnelState(client, cabinetId);

    const initialState = stateResult.data;
    const initialNow = typeof now === "function" ? now() : now;
    if (
      stateResult.error
      || !isFunnelSyncReady(initialState, cabinetId, initialNow)
    ) {
      return [];
    }
    if (initialState === null) return [];
    const initialFingerprint = funnelReadinessFingerprint(initialState);
    if (initialFingerprint === null) return [];

    const rows = await loadAllSupabasePages<FunnelRow>(
      (from, to) => (client.from("wb_funnel_daily") as FunnelPageQuery)
        .select("cabinet_id, nm_id, date, orders, orders_sum")
        .eq("cabinet_id", cabinetId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .order("cabinet_id", { ascending: true })
        .range(from, to),
      { maxPages: 300, label: "ОПиУ: заказы Funnel WB" },
    );

    const finalStateResult = await queryFunnelState(client, cabinetId);
    const finalState = finalStateResult.data;
    const finalNow = typeof now === "function" ? now() : now;
    if (
      finalStateResult.error
      || !isFunnelSyncReady(finalState, cabinetId, finalNow)
    ) {
      return [];
    }
    if (
      finalState === null
      || funnelReadinessFingerprint(finalState) !== initialFingerprint
    ) return [];

    return rows.map((row) => ({
      cabinetId: row.cabinet_id,
      date: row.date,
      nmId: row.nm_id,
      orders: row.orders,
      ordersSum: row.orders_sum,
    }));
  } catch {
    return [];
  }
}
