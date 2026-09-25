import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { OZON_AD_CABINET_TOTAL_SKU } from "@/lib/ozon/adDailyMarkers";
import { readCachedAccrualTypeIds, readCachedAccrualTypeNames } from "@/lib/ozon/accrualTypesCache";
import { buildOzonOpiuReport } from "@/lib/ozon/opiuOzonReport";

export const maxDuration = 60;

function resolveCabinetIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll("cabinetId").filter(Boolean);
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: allCabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("id, client_id")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });

  const requested = new Set(resolveCabinetIds(request));
  const cabinets = (allCabinets ?? []).filter((c) => requested.size === 0 || requested.has(String(c.id)));
  const cabinetIds = cabinets.map((c) => String(c.id));
  const clientIds = cabinets.map((c) => String(c.client_id));

  if (!cabinetIds.length) {
    return NextResponse.json({ report: null, cabinetIds: [], error: "Нет доступных кабинетов Ozon" }, { status: 200 });
  }

  const [accrualRes, postingsRes, adRes, typeNames, knownTypeIds] = await Promise.all([
    db
      .from("ozon_accrual_rows")
      .select("accrued_category, type_id, amount, extra")
      .in("cabinet_id", cabinetIds)
      .gte("date", dateFrom)
      .lte("date", dateTo),
    db
      .from("ozon_postings")
      .select("status, amount")
      .in("cabinet_id", cabinetIds)
      .gte("created_at", `${dateFrom}T00:00:00.000Z`)
      .lte("created_at", `${dateTo}T23:59:59.999Z`),
    db
      .from("ozon_ad_daily")
      .select("spent")
      .in("client_id", clientIds)
      .eq("sku", OZON_AD_CABINET_TOTAL_SKU)
      .gte("date", dateFrom)
      .lte("date", dateTo),
    readCachedAccrualTypeNames(db),
    readCachedAccrualTypeIds(db),
  ]);

  if (accrualRes.error) return NextResponse.json({ error: accrualRes.error.message }, { status: 502 });
  if (postingsRes.error) return NextResponse.json({ error: postingsRes.error.message }, { status: 502 });
  if (adRes.error) return NextResponse.json({ error: adRes.error.message }, { status: 502 });

  const input = {
    accrualRows: (accrualRes.data ?? []).map((r) => ({
      accrued_category: String(r.accrued_category),
      type_id: Number(r.type_id),
      amount: Number(r.amount),
      extra: (r.extra ?? null) as { sale_amount?: number } | null,
    })),
    postings: (postingsRes.data ?? []).map((r) => ({ status: String(r.status), amount: Number(r.amount) })),
    adSpend: (adRes.data ?? []).reduce((sum, r) => sum + Number(r.spent), 0),
    typeNames,
    knownTypeIds,
  };

  const report = buildOzonOpiuReport(input);
  return NextResponse.json({ report, cabinetIds });
}
