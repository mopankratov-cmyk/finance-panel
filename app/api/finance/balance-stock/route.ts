import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const monthValue = (value: string | null) => /^\d{4}-\d{2}$/.test(value ?? "") ? `${value}-01` : null;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const month = monthValue(request.nextUrl.searchParams.get("month"));
  if (!month) return NextResponse.json({ error: "Укажите месяц в формате ГГГГ-ММ" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const [runsResult, activeResult] = await Promise.all([
    db.from("balance_marketplace_stock_runs")
      .select("source_key,marketplace,cabinet_id,cabinet_name,status,rows_count,missing_cost_count,total_quantity,total_value,captured_at,error")
      .eq("snapshot_month", month).order("marketplace").order("cabinet_name"),
    db.from("wb_cabinets").select("id,name,marketplace").eq("is_active", true).in("marketplace", ["wb", "ozon"]),
  ]);
  if (runsResult.error) {
    const missing = /does not exist|schema cache/i.test(runsResult.error.message);
    return NextResponse.json({ error: missing ? "Примените миграцию месячных снимков баланса" : runsResult.error.message }, { status: missing ? 503 : 500 });
  }
  if (activeResult.error) return NextResponse.json({ error: activeResult.error.message }, { status: 500 });

  const runs = (runsResult.data ?? []).map((row) => ({
    sourceKey: String(row.source_key),
    marketplace: row.marketplace === "ozon" ? "ozon" as const : "wb" as const,
    cabinetId: row.cabinet_id ? String(row.cabinet_id) : null,
    cabinetName: String(row.cabinet_name),
    status: String(row.status),
    rowsCount: Number(row.rows_count ?? 0),
    missingCostCount: Number(row.missing_cost_count ?? 0),
    quantity: Number(row.total_quantity ?? 0),
    value: row.total_value == null ? null : Number(row.total_value),
    capturedAt: String(row.captured_at),
    error: row.error ? String(row.error) : null,
  }));
  const runCabinets = new Set(runs.map((run) => run.cabinetId).filter(Boolean));
  const missingCabinets = (activeResult.data ?? [])
    .filter((cabinet) => !runCabinets.has(String(cabinet.id)))
    .map((cabinet) => ({ id: String(cabinet.id), name: String(cabinet.name), marketplace: cabinet.marketplace === "ozon" ? "ozon" : "wb" }));
  const complete = runs.length > 0
    && missingCabinets.length === 0
    && runs.every((run) => run.status === "ok" && run.value !== null && run.missingCostCount === 0);
  return NextResponse.json({
    month,
    complete,
    amount: complete ? runs.reduce((sum, run) => sum + (run.value ?? 0), 0) : null,
    quantity: runs.reduce((sum, run) => sum + run.quantity, 0),
    runs,
    missingCabinets,
    capturedAt: runs.map((run) => run.capturedAt).sort().at(0) ?? null,
  });
}
