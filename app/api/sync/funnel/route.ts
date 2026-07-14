import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { rotateFunnelTargets, syncFunnelPeriod } from "@/lib/wb/funnelPeriod";
import { fetchWbFunnelHistory } from "@/lib/wb/funnelRequest";
import type { SupabaseClient } from "@supabase/supabase-js";

const HISTORY_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history";
const NM_BATCH = 20;
const RATE_LIMIT_WAIT_MS = 21_000;
const REQUEST_RESERVE_MS = 5_000;

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

  const period = syncFunnelPeriod(request.url); // история доступна до вчера; по понедельникам восстанавливаем последние 7 дней.

  let total = 0;
  const errors: string[] = [];
  const rotated: string[] = [];

  // Бюджет на джобу (60с-функция): успеть upsert и лог. Внутри окна — несколько батчей.
  // Оставляем 15с от Vercel maxDuration на финальный upsert и sync_log.
  const deadline = Date.now() + 45_000;
  // Срез дня для ротации (разные SKU в разные дни — полное покрытие за неск. прогонов).
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
  // В 60с обычно помещаются не все кабинеты. Меняем стартовый кабинет каждый день,
  // чтобы поздние в списке не голодали и автоматически догружались в следующем цикле.
  const rotatedTargets = rotateFunnelTargets(targets, dayOfYear);

  try {
    for (const t of rotatedTargets) {
      if (Date.now() + REQUEST_RESERVE_MS > deadline) { rotated.push(`${t.name}: пропущен (бюджет)`); break; } // докрутим следующим прогоном
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
        if (Date.now() + REQUEST_RESERVE_MS > deadline) break; // тайм-бокс: остальное доберём следующим прогоном
        if (processed > 0) {
          if (Date.now() + RATE_LIMIT_WAIT_MS + REQUEST_RESERVE_MS > deadline) break;
          await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS)); // analytics: 3 req/мин (тот же токен)
        }
        const batch = batches[(startB + k) % batches.length];

        const res = await fetchWbFunnelHistory({
          url: HISTORY_URL,
          token: t.statsToken,
          body: JSON.stringify({ nmIds: batch, selectedPeriod: { start: period.begin, end: period.end } }),
          deadline,
          reserveMs: REQUEST_RESERVE_MS,
          fallbackWaitMs: RATE_LIMIT_WAIT_MS,
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
    return NextResponse.json(
      { ok, rows: total, cabinets: targets.length, period, rotated, errors },
      { status: ok ? 200 : 502 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("funnel", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
