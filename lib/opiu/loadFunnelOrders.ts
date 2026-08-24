import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import {
  funnelTrustCutoff,
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
  lt(column: string, value: string): FunnelPageQuery;
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

/** null = "без ограничений" (позже любой конкретной даты). */
function cutoffAtLeast(cutoff: string | null, other: string | null): boolean {
  if (cutoff === null) return true;
  if (other === null) return false;
  return other >= cutoff;
}

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
    if (stateResult.error) return [];
    const initialTrust = funnelTrustCutoff(initialState, cabinetId, initialNow);
    if (!initialTrust.ready) return [];
    // Часть диапазона на/после cutoff ещё не досинкана предыдущими проходами —
    // если весь диапазон уже упирается в неё, нет смысла даже запрашивать.
    if (initialTrust.cutoff !== null && initialTrust.cutoff <= dateFrom) return [];

    const rows = await loadAllSupabasePages<FunnelRow>(
      (from, to) => {
        let query = (client.from("wb_funnel_daily") as FunnelPageQuery)
          .select("cabinet_id, nm_id, date, orders, orders_sum")
          .eq("cabinet_id", cabinetId)
          .gte("date", dateFrom)
          .lte("date", dateTo);
        if (initialTrust.cutoff !== null) query = query.lt("date", initialTrust.cutoff);
        return query
          .order("date", { ascending: true })
          .order("nm_id", { ascending: true })
          .order("cabinet_id", { ascending: true })
          .range(from, to);
      },
      { maxPages: 300, label: "ОПиУ: заказы Funnel WB" },
    );

    const finalStateResult = await queryFunnelState(client, cabinetId);
    const finalState = finalStateResult.data;
    const finalNow = typeof now === "function" ? now() : now;
    if (finalStateResult.error) return [];
    const finalTrust = funnelTrustCutoff(finalState, cabinetId, finalNow);
    if (!finalTrust.ready) return [];
    // Окно доверия не должно было сжаться, пока мы читали wb_funnel_daily —
    // иначе часть уже прочитанных строк могла оказаться недосинканной.
    // (null = "без ограничений" — сравниваем через cutoffAtLeast, а не
    // напрямую, чтобы поймать и случай "было null, стало ограничено".)
    if (!cutoffAtLeast(initialTrust.cutoff, finalTrust.cutoff)) {
      return [];
    }

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
