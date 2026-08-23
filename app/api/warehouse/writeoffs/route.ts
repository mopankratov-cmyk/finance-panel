import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export interface WriteoffRow {
  id: number;
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  productId: string;
  nmId: number | null;
  article: string;
  sizeLabel: string;
  qty: number;
  amount: number;
  reason: string | null;
  docType: string;
  occurredAt: string;
  createdBy: string | null;
}

export interface WriteoffsResponse {
  rows: WriteoffRow[];
  monthQty: number;
  monthAmount: number;
  truncated: boolean;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230012_defects_writeoffs.sql";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  const { data, error } = await db
    .from("stock_moves")
    .select("id, warehouse_id, variant_id, product_id, nm_id, article, qty, amount, note, doc_type, occurred_at, created_by")
    .eq("legal_entity_id", scope.entity.id)
    .eq("kind", "writeoff")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  // Размер подтягиваем одним запросом: журнал должен называть, какой именно размер списан.
  const variantIds = [...new Set((data ?? []).map((row) => String(row.variant_id)).filter(Boolean))];
  const sizes = new Map<string, string>();
  if (variantIds.length > 0) {
    const variants = await db.from("product_variants").select("id, size_label").in("id", variantIds);
    for (const variant of variants.data ?? []) sizes.set(String(variant.id), String(variant.size_label ?? ""));
  }

  const rows: WriteoffRow[] = (data ?? []).map((row) => ({
    id: Number(row.id),
    warehouseId: String(row.warehouse_id),
    warehouseName: names.get(String(row.warehouse_id)) ?? "склад удалён",
    variantId: String(row.variant_id),
    productId: String(row.product_id),
    nmId: row.nm_id === null ? null : Number(row.nm_id),
    article: String(row.article ?? ""),
    sizeLabel: sizes.get(String(row.variant_id)) ?? "",
    qty: Math.abs(Number(row.qty)),
    amount: Math.abs(Number(row.amount)),
    reason: row.note,
    docType: String(row.doc_type),
    occurredAt: String(row.occurred_at),
    createdBy: row.created_by,
  }));

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthRows = rows.filter((row) => new Date(row.occurredAt) >= monthStart);

  const payload: WriteoffsResponse = {
    rows,
    monthQty: monthRows.reduce((sum, row) => sum + row.qty, 0),
    monthAmount: monthRows.reduce((sum, row) => sum + row.amount, 0),
    truncated: rows.length === PAGE_SIZE,
  };
  return NextResponse.json({ data: payload, error: null });
}

/** Ручное списание: порча, недостача — всё, что всплыло позже приёмки. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; warehouseId?: string; reason?: string; lines?: { variantId: string; qty: number }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад", 400);
  const reason = String(body.reason ?? "").trim();
  if (!reason) return fail("Укажите причину списания — «просто пропало» не бывает", 400);

  const lines = (body.lines ?? []).filter((line) => line.variantId && Number(line.qty) > 0);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db.rpc("post_writeoff", {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_lines: lines.map((line) => ({ variantId: line.variantId, qty: Math.round(line.qty) })),
    p_reason: reason,
    p_actor: session?.email ?? null,
  });

  if (error) {
    const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
    if (shortage) return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  return NextResponse.json({ data, error: null }, { status: 201 });
}
