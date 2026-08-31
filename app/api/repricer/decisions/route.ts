import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { filterRepricerRowsByScopes, type RepricerScopedRow } from "@/lib/repricer/scope";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";

// GET /api/repricer/decisions?date=&cabinet= — решения прогона.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ decisions: [] });

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const requestedCabinet = url.searchParams.get("cabinet");
  const { cabinetId } = await resolveShopCabinet(requestedCabinet ?? undefined);
  if (requestedCabinet && requestedCabinet !== "all" && !cabinetId) {
    return NextResponse.json({ error: "WB-кабинет не найден" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  // Решения листаются: `limit(2000)` не спасал — Supabase отдаёт максимум
  // тысячу строк за запрос, и выгрузка «Новые цены» молча теряла всё, что за
  // ней. Потерянная строка здесь — это товар, которому не поменяли цену.
  let data: RepricerScopedRow[];
  try {
    data = await loadAllSupabasePages<RepricerScopedRow>((from, to) => {
      let q = db.from("repricer_decisions")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (date) q = q.eq("run_date", date);
      if (cabinetId) q = q.eq("cabinet", cabinetId);
      return q;
    }, { label: "Репрайсер: решения", maxPages: 50 });
  } catch (error) {
    return NextResponse.json({ decisions: [], error: error instanceof Error ? error.message : "Ошибка чтения решений" });
  }
  const cabinets = await getActiveWbCabinets();
  const scopes = new Map(cabinets.map((cabinet) => [cabinet.id, cabinetProductScope(cabinet)]));
  const decisions = filterRepricerRowsByScopes(data, scopes);
  return NextResponse.json({ count: decisions.length, decisions });
}
