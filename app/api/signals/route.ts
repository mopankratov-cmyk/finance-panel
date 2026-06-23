import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildRnpReport, type RnpRow } from "@/lib/rnp/buildRnp";
import { getWbCommissionMerged } from "@/lib/wb/commissions";
import { solvePrices } from "@/lib/unit/priceSolver";
import { classifySignal, DEFAULT_THRESHOLDS, type SignalMetrics } from "@/lib/signals/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/signals?cabinet=&window=14&persist=0
// Классифицирует «узкое место» каждого SKU. persist=1 → пишет не-OK в agent_insights (идемпотентно за день).
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const cabinet = url.searchParams.get("cabinet");
  const windowDays = Math.min(60, Math.max(1, Number(url.searchParams.get("window")) || 14));
  const persist = url.searchParams.get("persist") === "1";

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  let rnp: RnpRow[];
  try {
    rnp = await buildRnpReport(cabinet);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
  const comm = await getWbCommissionMerged(30);

  // Воронка за окно: сумма открытий/корзин/заказов на nm.
  const fromDate = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  const funnel = new Map<number, { opens: number; carts: number; orders: number }>();
  const { data: frows } = await db
    .from("wb_funnel_daily")
    .select("nm_id, open_card, add_to_cart, orders")
    .gte("date", fromDate);
  for (const r of (frows ?? []) as { nm_id: number; open_card: number | null; add_to_cart: number | null; orders: number | null }[]) {
    const e = funnel.get(r.nm_id) ?? { opens: 0, carts: 0, orders: 0 };
    e.opens += Number(r.open_card ?? 0);
    e.carts += Number(r.add_to_cart ?? 0);
    e.orders += Number(r.orders ?? 0);
    funnel.set(r.nm_id, e);
  }

  const items = rnp.map((r) => {
    const f = funnel.get(r.nmId) ?? { opens: 0, carts: 0, orders: 0 };
    const rates = comm.byNm.get(r.nmId);
    const feeFraction = ((rates?.pct ?? comm.avgPct) + (rates?.acqPct ?? comm.avgAcqPct) + (rates?.extraPct ?? comm.avgExtraPct) + comm.overheadPct) / 100;
    const month = r.periods.month;
    const currentRevenue = month.ordersCount > 0 ? month.ordersSum / month.ordersCount : 0;
    const marginPct = solvePrices({ cogs: r.cost ?? 0, feeFraction, currentRevenue, margins: [] }).currentMarginPct;

    const metrics: SignalMetrics = {
      opens: f.opens,
      carts: f.carts,
      orders: f.orders,
      stock: r.stock,
      turnoverDays: r.turnoverDays,
      drr: r.drr,
      marginPct,
      ordersCountMonth: month.ordersCount,
    };
    const sig = classifySignal(metrics, DEFAULT_THRESHOLDS);
    return { nm: r.nmId, article: r.article, ...sig, metrics };
  });

  if (persist) {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = today + "T00:00:00.000Z";
    await db.from("agent_insights").delete().eq("module", "wb_signal").gte("created_at", todayStart);
    const toInsert = items
      .filter((i) => i.signal !== "OK")
      .map((i) => ({
        module: "wb_signal",
        severity: i.severity,
        title: i.signal,
        body: `${i.article}: ${i.reason}`,
        data: { nm: i.nm, article: i.article, date: today, signal: i.signal, metrics: i.metrics },
      }));
    if (toInsert.length) await db.from("agent_insights").insert(toInsert);
  }

  // Сводка по типам
  const summary: Record<string, number> = {};
  for (const i of items) summary[i.signal] = (summary[i.signal] ?? 0) + 1;

  return NextResponse.json({ window: windowDays, count: items.length, persisted: persist, summary, items });
}
