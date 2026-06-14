import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import type { SupabaseClient } from "@supabase/supabase-js";

const HISTORY_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history";
const NM_BATCH = 20;

// воронка с паузами 21с между батчами (на кабинет) может идти дольше дефолта
export const maxDuration = 60;

interface HistoryDay {
  date?: string;
  openCount?: number;
  cartCount?: number;
  orderCount?: number;
  orderSum?: number;
  buyoutCount?: number;
  buyoutSum?: number;
}

interface HistoryItem {
  product?: { nmId?: number };
  history?: HistoryDay[];
}

// nm_id, по которым тянем воронку, в разрезе кабинета (остатки + заказы за 30 дней).
async function nmIdsForCabinet(db: SupabaseClient, cabinetId: string | null): Promise<number[]> {
  let sq = db.from("wb_stocks").select("nm_id");
  sq = cabinetId === null ? sq.is("cabinet_id", null) : sq.eq("cabinet_id", cabinetId);
  const { data: stockRows } = await sq;

  let oq = db
    .from("wb_orders")
    .select("nm_id")
    .gte("date", new Date(Date.now() - 30 * 86400000).toISOString())
    .limit(1000);
  oq = cabinetId === null ? oq.is("cabinet_id", null) : oq.eq("cabinet_id", cabinetId);
  const { data: orderRows } = await oq;

  return [
    ...new Set([
      ...(stockRows ?? []).map((r) => r.nm_id as number),
      ...(orderRows ?? []).map((r) => r.nm_id as number),
    ]),
  ];
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  const end = new Date();
  end.setDate(end.getDate() - 1); // история доступна до вчера
  const begin = new Date(end);
  begin.setDate(begin.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      const nmIds = await nmIdsForCabinet(db, t.cabinetId);
      if (!nmIds.length) continue;

      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < nmIds.length; i += NM_BATCH) {
        const batch = nmIds.slice(i, i + NM_BATCH);
        if (i > 0) await new Promise((r) => setTimeout(r, 21000)); // analytics: 3 req/мин

        const res = await fetch(HISTORY_URL, {
          method: "POST",
          headers: { Authorization: t.statsToken, "Content-Type": "application/json" },
          body: JSON.stringify({ nmIds: batch, selectedPeriod: { start: fmt(begin), end: fmt(end) } }),
          cache: "no-store",
        });
        if (!res.ok) {
          errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
          break;
        }

        const json = (await res.json()) as HistoryItem[];
        for (const item of json ?? []) {
          const nmId = item.product?.nmId;
          if (!nmId) continue;
          for (const day of item.history ?? []) {
            if (!day.date) continue;
            rows.push({
              nm_id: nmId,
              date: day.date.slice(0, 10),
              open_card: day.openCount ?? 0,
              add_to_cart: day.cartCount ?? 0,
              orders: day.orderCount ?? 0,
              orders_sum: day.orderSum ?? 0,
              buyouts: day.buyoutCount ?? 0,
              buyout_sum: day.buyoutSum ?? 0,
              cabinet_id: t.cabinetId,
            });
          }
        }
      }

      if (rows.length) {
        const upsertError = await chunkedUpsert("wb_funnel_daily", rows, "nm_id,date");
        if (upsertError) {
          errors.push(`${t.name}: ${upsertError}`);
          continue;
        }
        total += rows.length;
      }
    }

    const ok = errors.length === 0;
    await writeSyncLog("funnel", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("funnel", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
