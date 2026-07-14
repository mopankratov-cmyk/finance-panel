import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { hasMpstats, itemSubject, mpstatsRouteError } from "@/lib/mpstats/client";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { allowsProduct } from "@/lib/wb/productScope";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Авто-определение ниш (предметов WB), в которых работают наши кабинеты.
// По топ-SKU каждого кабинета берём subject из MPStats items/{nm}/full → агрегат.
// Тяжело (N вызовов) → общий часовой снимок в Next Data Cache.
const PER_CAB = 12; // топ-SKU на кабинет (бережём квоту)

export async function GET(request: NextRequest) {
  try {
    return await loadNiches(request);
  } catch (error) {
    const failure = mpstatsRouteError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

async function loadNiches(request: NextRequest) {
  if (!hasMpstats()) return NextResponse.json({ error: "MPSTATS_TOKEN не настроен" }, { status: 501 });
  const { cabinetId } = await resolveShopCabinet(request.nextUrl.searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const payload = await loadHourlyDashboard(
    "wb-market-niches",
    { cabinetId },
    async () => {

  const allCabinets = await getActiveWbCabinets();
  const cabs = cabinetId ? allCabinets.filter((cabinet) => cabinet.id === cabinetId) : allCabinets;
  const subj = new Map<number, { id: number; name: string; sku_count: number; cabinets: Set<string> }>();

  for (const c of cabs) {
    const productScope = cabinetProductScope(c);
    const rep = await db.rpc("rnp_report", { p_cabinet: c.id });
    const top = ((rep.data ?? []) as { nm_id: number; orders_sum_month: number }[])
      .filter((row) => allowsProduct(productScope, row.nm_id))
      .slice()
      .sort((a, b) => Number(b.orders_sum_month ?? 0) - Number(a.orders_sum_month ?? 0))
      .slice(0, PER_CAB)
      .map((r) => r.nm_id);
    const subs = await Promise.all(top.map((nm) => itemSubject(nm)));
    for (const s of subs) {
      if (!s) continue;
      const e = subj.get(s.id) ?? { id: s.id, name: s.name, sku_count: 0, cabinets: new Set<string>() };
      e.sku_count += 1;
      e.cabinets.add(c.name);
      subj.set(s.id, e);
    }
  }

  const niches = [...subj.values()]
    .map((e) => ({ id: e.id, name: e.name, sku_count: e.sku_count, cabinets: [...e.cabinets] }))
    .sort((a, b) => b.sku_count - a.sku_count);

      return { ok: true, niches, count: niches.length };
    },
    { forceRefresh: request.nextUrl.searchParams.get("refresh") === "1" },
  );
  return NextResponse.json(payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
