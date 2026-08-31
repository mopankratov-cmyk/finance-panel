import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { filterRepricerRowsByScopes } from "@/lib/repricer/scope";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { buildXlsx } from "@/lib/xlsx/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecRow {
  cabinet: string | null;
  article: string | null; nm_id: number; old_price: number | null;
  new_price: number | null; strategy_name: string | null; note: string | null;
}

// GET /api/repricer/export?date=&cabinet= — XLSX «Новые цены» из предложенных решений.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const requestedCabinet = url.searchParams.get("cabinet");
  const { cabinetId } = await resolveShopCabinet(requestedCabinet ?? undefined);
  if (!cabinetId) {
    return NextResponse.json({ error: "Для экспорта выберите один WB-кабинет" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  // Файл «Новые цены» — это то, что человек унесёт в кабинет WB. Без листания
  // в него попадала первая тысяча строк, а остальным товарам цену просто не
  // меняли: молча, без единого признака на экране.
  let data: DecRow[];
  try {
    data = await loadAllSupabasePages<DecRow>((from, to) => db
      .from("repricer_decisions")
      .select("cabinet, article, nm_id, old_price, new_price, strategy_name, note")
      .eq("run_date", date)
      .eq("status", "proposed")
      .eq("cabinet", cabinetId)
      .order("nm_id", { ascending: true })
      .range(from, to), { label: "Репрайсер: выгрузка новых цен", maxPages: 50 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Не удалось прочитать решения" }, { status: 500 });
  }

  const cabinets = await getActiveWbCabinets();
  const scopes = new Map(cabinets.map((cabinet) => [cabinet.id, cabinetProductScope(cabinet)]));
  const decisions = filterRepricerRowsByScopes(data, scopes);

  const rows: (string | number | null | undefined)[][] = [
    ["Артикул", "nmID", "Старая цена", "Новая цена", "Стратегия", "Примечание"],
  ];
  for (const r of decisions) {
    rows.push([r.article, r.nm_id, r.old_price, r.new_price, r.strategy_name, r.note]);
  }
  const buf = buildXlsx("Репрайсер", rows);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="repricer_${cabinetId}_${date}.xlsx"`,
    },
  });
}
