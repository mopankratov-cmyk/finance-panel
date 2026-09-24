import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const KINDS = ["fulfillment", "wb", "ozon", "supplier_transit"] as const;
type SourceKind = (typeof KINDS)[number];
const monthValue = (value: string | null) => /^\d{4}-\d{2}$/.test(value ?? "") ? `${value}-01` : null;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const month = monthValue(request.nextUrl.searchParams.get("month"));
  if (!month) return NextResponse.json({ error: "Укажите месяц в формате ГГГГ-ММ" }, { status: 400 });
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind = KINDS.includes(kindParam as SourceKind) ? kindParam as SourceKind : null;
  if (kindParam && !kind) return NextResponse.json({ error: "Неизвестная группа остатков" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  if (kind) {
    const result = await db.from("balance_marketplace_stock_lines")
      .select("source_key,line_key,source_kind,article,product_name,location_name,reference,quantity,cost_rub,packaging_rub,unit_value,total_value,captured_at")
      .eq("snapshot_month", month).eq("source_kind", kind).order("article");
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({
      month,
      kind,
      lines: (result.data ?? []).map((row) => ({
        id: `${row.source_key}:${row.line_key}`,
        sourceKey: String(row.source_key),
        article: String(row.article),
        name: String(row.product_name ?? ""),
        location: String(row.location_name ?? ""),
        reference: row.reference ? String(row.reference) : null,
        quantity: Number(row.quantity ?? 0),
        costRub: row.cost_rub == null ? null : Number(row.cost_rub),
        packagingRub: row.packaging_rub == null ? null : Number(row.packaging_rub),
        unitValue: row.unit_value == null ? null : Number(row.unit_value),
        totalValue: row.total_value == null ? null : Number(row.total_value),
      })),
    });
  }

  const [runsResult, activeResult] = await Promise.all([
    db.from("balance_marketplace_stock_runs")
      .select("source_key,source_kind,source_label,marketplace,cabinet_id,cabinet_name,status,rows_count,missing_cost_count,total_quantity,total_value,captured_at,error,is_provisional,snapshot_cutoff,reconciled_at")
      .eq("snapshot_month", month).order("source_kind").order("source_label"),
    db.from("wb_cabinets").select("id,name,marketplace").eq("is_active", true).in("marketplace", ["wb", "ozon"]),
  ]);
  if (runsResult.error) {
    const missing = /does not exist|schema cache/i.test(runsResult.error.message);
    return NextResponse.json({ error: missing ? "Примените миграцию месячных снимков баланса" : runsResult.error.message }, { status: missing ? 503 : 500 });
  }
  if (activeResult.error) return NextResponse.json({ error: activeResult.error.message }, { status: 500 });

  const runs = (runsResult.data ?? []).map((row) => ({
    sourceKey: String(row.source_key),
    kind: String(row.source_kind) as SourceKind,
    label: String(row.source_label),
    cabinetId: row.cabinet_id ? String(row.cabinet_id) : null,
    cabinetName: row.cabinet_name ? String(row.cabinet_name) : null,
    status: String(row.status),
    rowsCount: Number(row.rows_count ?? 0),
    missingCostCount: Number(row.missing_cost_count ?? 0),
    quantity: Number(row.total_quantity ?? 0),
    value: row.total_value == null ? null : Number(row.total_value),
    capturedAt: String(row.captured_at),
    error: row.error ? String(row.error) : null,
    provisional: Boolean(row.is_provisional),
    snapshotCutoff: row.snapshot_cutoff ? String(row.snapshot_cutoff) : null,
    reconciledAt: row.reconciled_at ? String(row.reconciled_at) : null,
  }));
  const expected = new Map<string, { kind: SourceKind; label: string }>([
    ["fulfillment:all", { kind: "fulfillment", label: "Фулфилмент" }],
    ["supplier_transit:all", { kind: "supplier_transit", label: "В пути от поставщика" }],
  ]);
  for (const cabinet of activeResult.data ?? []) {
    const marketplace = cabinet.marketplace === "ozon" ? "ozon" : "wb";
    expected.set(`${marketplace}:${cabinet.id}`, { kind: marketplace, label: `${marketplace.toUpperCase()} · ${cabinet.name}` });
  }
  const runKeys = new Set(runs.map((run) => run.sourceKey));
  const missingSources = [...expected].filter(([key]) => !runKeys.has(key)).map(([key, value]) => ({ sourceKey: key, ...value }));
  const categories = KINDS.map((categoryKind) => {
    const categoryRuns = runs.filter((run) => run.kind === categoryKind);
    const missing = missingSources.filter((source) => source.kind === categoryKind);
    const complete = categoryRuns.length > 0 && missing.length === 0
      && categoryRuns.every((run) => run.status === "ok" && run.value !== null && run.missingCostCount === 0);
    return {
      kind: categoryKind,
      complete,
      amount: complete ? round2(categoryRuns.reduce((sum, run) => sum + (run.value ?? 0), 0)) : null,
      quantity: categoryRuns.reduce((sum, run) => sum + run.quantity, 0),
      rowsCount: categoryRuns.reduce((sum, run) => sum + run.rowsCount, 0),
      provisional: categoryRuns.some((run) => run.provisional),
      reconciledAt: categoryRuns.map((run) => run.reconciledAt).filter(Boolean).sort().at(-1) ?? null,
      errors: [...categoryRuns.map((run) => run.error).filter(Boolean), ...missing.map((source) => `нет снимка: ${source.label}`)],
    };
  });
  const complete = categories.every((category) => category.complete);
  return NextResponse.json({
    month,
    complete,
    amount: complete ? round2(categories.reduce((sum, category) => sum + (category.amount ?? 0), 0)) : null,
    quantity: categories.reduce((sum, category) => sum + category.quantity, 0),
    categories,
    runs,
    missingSources,
    capturedAt: runs.map((run) => run.capturedAt).sort().at(0) ?? null,
  });
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
