import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import type { SupabaseClient } from "@supabase/supabase-js";

const HISTORY_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history";
const NM_BATCH = 20;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

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

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mskDate(offsetDays = 0): Date {
  const d = new Date(Date.now() + MSK_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function syncPeriod(request: NextRequest): { begin: string; end: string; mode: string } {
  const params = new URL(request.url).searchParams;
  const forcedFrom = params.get("from");
  const forcedTo = params.get("to");
  if (forcedFrom && forcedTo) return { begin: forcedFrom, end: forcedTo, mode: "manual" };

  const yesterday = mskDate(-1);
  const todayMsk = mskDate();
  const mode = params.get("period") ?? "auto";
  const weeklyMonthRefresh = mode === "month" || (mode === "auto" && todayMsk.getUTCDay() === 1);

  if (weeklyMonthRefresh) {
    const begin = new Date(Date.UTC(todayMsk.getUTCFullYear(), todayMsk.getUTCMonth(), 1));
    if (dateOnly(begin) <= dateOnly(yesterday)) return { begin: dateOnly(begin), end: dateOnly(yesterday), mode: "month" };
  }

  if (mode === "7d") {
    const begin = new Date(yesterday);
    begin.setUTCDate(begin.getUTCDate() - 6);
    return { begin: dateOnly(begin), end: dateOnly(yesterday), mode: "7d" };
  }

  return { begin: dateOnly(yesterday), end: dateOnly(yesterday), mode: "yesterday" };
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

  const period = syncPeriod(request); // история доступна до вчера; auto: вчера ежедневно, текущий месяц по понедельникам.

  let total = 0;
  const errors: string[] = [];
  const rotated: string[] = [];

  // Бюджет на джобу (60с-функция): успеть upsert и лог. Внутри окна — несколько батчей.
  const deadline = Date.now() + 50_000;
  // Срез дня для ротации (разные SKU в разные дни — полное покрытие за неск. прогонов).
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);

  try {
    for (const t of targets) {
      if (Date.now() > deadline) { rotated.push(`${t.name}: пропущен (бюджет)`); break; } // докрутим следующим прогоном
      const nmIds = await nmIdsForCabinet(db, t.cabinetId);
      if (!nmIds.length) continue;

      // батчи SKU; стартуем со сдвигом по дню, идём по кругу
      const batches: number[][] = [];
      for (let i = 0; i < nmIds.length; i += NM_BATCH) batches.push(nmIds.slice(i, i + NM_BATCH));
      const startB = batches.length ? dayOfYear % batches.length : 0;
      if (batches.length > 1) rotated.push(`${t.name}: срез ${startB + 1}/${batches.length}`);

      const rows: Record<string, unknown>[] = [];
      let processed = 0;
      for (let k = 0; k < batches.length; k++) {
        if (Date.now() > deadline) break; // тайм-бокс: остальное доберём следующим прогоном
        if (processed > 0) await new Promise((r) => setTimeout(r, 21000)); // analytics: 3 req/мин (тот же токен)
        const batch = batches[(startB + k) % batches.length];

        const res = await fetch(HISTORY_URL, {
          method: "POST",
          headers: { Authorization: t.statsToken, "Content-Type": "application/json" },
          body: JSON.stringify({ nmIds: batch, selectedPeriod: { start: period.begin, end: period.end } }),
          cache: "no-store",
        });
        processed++;
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
    const note = rotated.length ? ` [ротация: ${rotated.join(", ")}]` : "";
    await writeSyncLog("funnel", ok ? "ok" : "error", total, (errors.join("; ") + note).trim() || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, period, rotated, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("funnel", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
