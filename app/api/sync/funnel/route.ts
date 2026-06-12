import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN;
const HISTORY_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history";
const NM_BATCH = 20;

// воронка с паузами 21с между батчами может идти дольше дефолта
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

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();

  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  if (!WB_STATS_TOKEN) {
    return NextResponse.json({ error: "WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  try {
    const { data: stockRows, error: nmError } = await db
      .from("wb_stocks")
      .select("nm_id");
    if (nmError) throw new Error(nmError.message);

    const { data: orderRows } = await db
      .from("wb_orders")
      .select("nm_id")
      .gte("date", new Date(Date.now() - 30 * 86400000).toISOString())
      .limit(1000);

    const nmIds = [
      ...new Set([
        ...(stockRows ?? []).map((r) => r.nm_id as number),
        ...(orderRows ?? []).map((r) => r.nm_id as number),
      ]),
    ];

    if (!nmIds.length) {
      await writeSyncLog("funnel", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0 });
    }

    const end = new Date();
    end.setDate(end.getDate() - 1); // история доступна до вчера
    const begin = new Date(end);
    begin.setDate(begin.getDate() - 6);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < nmIds.length; i += NM_BATCH) {
      const batch = nmIds.slice(i, i + NM_BATCH);
      // rate limit analytics API: 3 req/мин
      if (i > 0) await new Promise((r) => setTimeout(r, 21000));

      const res = await fetch(HISTORY_URL, {
        method: "POST",
        headers: {
          Authorization: WB_STATS_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nmIds: batch,
          selectedPeriod: { start: fmt(begin), end: fmt(end) },
        }),
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`WB ${res.status}: ${text.slice(0, 200)}`);
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
          });
        }
      }
    }

    const upsertError = await chunkedUpsert("wb_funnel_daily", rows, "nm_id,date");
    if (upsertError) {
      await writeSyncLog("funnel", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    await writeSyncLog("funnel", "ok", rows.length, null, startedAt);
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("funnel", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
