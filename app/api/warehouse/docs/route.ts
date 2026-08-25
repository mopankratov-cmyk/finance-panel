import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import type { StockDocKind } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export interface StockDocRow {
  id: string;
  number: string;
  kind: StockDocKind;
  status: "draft" | "posted" | "reversed";
  warehouseName: string | null;
  targetWarehouseName: string | null;
  /** Кабинет-адресат отгрузки. У перемещения и списания его нет. */
  cabinetName: string | null;
  occurredAt: string;
  note: string | null;
  qty: number;
  amount: number;
  lines: number;
  createdBy: string | null;
  /** Номер документа, которым это сторнировано, либо который сторнирует этот. */
  reversedByNumber: string | null;
  reversesNumber: string | null;
}

export interface StockDocsResponse {
  rows: StockDocRow[];
  truncated: boolean;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608240021 и 202608240022";

const num = (result: unknown, key: string): number => {
  const value = (result as Record<string, unknown> | null)?.[key];
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
};

/** Журнал документов: что именно проводили, под каким номером и кто. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("stock_docs")
    .select("id, number, kind, status, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, result, created_by, reversed_by, reverses")
    .eq("legal_entity_id", scope.entity.id)
    .order("occurred_at", { ascending: false })
    .order("number", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinets = new Map(scope.entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  // Номера связанных документов: в журнале ссылка должна читаться как номер,
  // а не как идентификатор.
  const linkedIds = [...new Set((data ?? []).flatMap((row) => [row.reversed_by, row.reverses]).filter(Boolean).map(String))];
  const linkedNumbers = new Map<string, string>();
  if (linkedIds.length > 0) {
    const linked = await db.from("stock_docs").select("id, number").in("id", linkedIds);
    for (const row of linked.data ?? []) linkedNumbers.set(String(row.id), String(row.number));
  }

  const rows: StockDocRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    number: String(row.number),
    kind: row.kind as StockDocKind,
    status: row.status as StockDocRow["status"],
    warehouseName: row.warehouse_id ? names.get(String(row.warehouse_id)) ?? "склад удалён" : null,
    targetWarehouseName: row.target_warehouse_id ? names.get(String(row.target_warehouse_id)) ?? "склад удалён" : null,
    cabinetName: row.cabinet_id ? cabinets.get(String(row.cabinet_id)) ?? "кабинет" : null,
    occurredAt: String(row.occurred_at),
    note: row.note,
    qty: num(row.result, "qty"),
    amount: Math.abs(num(row.result, "amount")),
    lines: num(row.result, "lines") || num(row.result, "posted"),
    createdBy: row.created_by,
    reversedByNumber: row.reversed_by ? linkedNumbers.get(String(row.reversed_by)) ?? null : null,
    reversesNumber: row.reverses ? linkedNumbers.get(String(row.reverses)) ?? null : null,
  }));

  const payload: StockDocsResponse = { rows, truncated: rows.length === PAGE_SIZE };
  return NextResponse.json({ data: payload, error: null });
}
