import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities, resolveEntity } from "@/lib/warehouse/entityAccess";
import { assertVariantsInScope } from "@/lib/warehouse/ownership";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import { recordStockDoc } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202609140009/0010_opening_balance*.sql";

export interface OpeningBalanceVariantRow {
  id: string;
  article: string;
  name: string;
  sizeLabel: string;
  nmId: number | null;
}

/**
 * Начальные остатки (§5.1): доступны только юрлицу без единой проводки — ни
 * прихода, ни отгрузки, ничего. GET отвечает именно на этот вопрос и заодно
 * отдаёт каталог размеров ЭТОГО юрлица — не общий /api/warehouse/variants
 * (тот отдаёт весь справочник компании без привязки к юрлицу, а тут выбор
 * обязан быть ограничен одним).
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const [moves, variants] = await Promise.all([
    db.from("stock_moves").select("id").eq("legal_entity_id", scope.entity.id).limit(1),
    db
      .from("product_variants")
      .select("id, size_label, products!inner(article, name, nm_id, legal_entity_id)")
      .eq("is_active", true)
      .eq("products.legal_entity_id", scope.entity.id)
      .order("position")
      .order("size_label"),
  ]);
  if (moves.error) return fail(missingMigration(moves.error.code) ? migrationHint : moves.error.message, missingMigration(moves.error.code) ? 503 : 500);
  if (variants.error) return fail(variants.error.message, 500);

  const rows: OpeningBalanceVariantRow[] = (variants.data ?? []).map((row) => {
    const record = row as unknown as Record<string, unknown>;
    const product = (record.products ?? {}) as Record<string, unknown>;
    return {
      id: String(record.id),
      article: String(product.article ?? ""),
      name: String(product.name ?? ""),
      sizeLabel: String(record.size_label ?? ""),
      nmId: product.nm_id === null || product.nm_id === undefined ? null : Number(product.nm_id),
    };
  }).sort((a, b) => a.article.localeCompare(b.article, "ru") || a.sizeLabel.localeCompare(b.sizeLabel, "ru"));

  return NextResponse.json({ data: { eligible: (moves.data ?? []).length === 0, variants: rows }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; docKey?: string; warehouseId?: string; note?: string; occurredAt?: string;
        lines?: { variantId: string; qty: number; unitCost: number }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад", 400);

  const lines = (body.lines ?? []).filter((line) => line.variantId && Number(line.qty) > 0 && Number(line.unitCost) >= 0);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию с количеством и себестоимостью", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();
  // Кнопка спрятана от роли warehouse в интерфейсе, но спрятанная кнопка —
  // не защита: тот же серверный сторож, что уже стоит на products/tasks.
  if (!canManageStock(session?.role)) return fail(OPERATOR_FORBIDDEN, 403);

  const scopeList = await listAccessibleEntities();
  if (!scopeList.ok) return fail(scopeList.error, scopeList.status);
  const lineScope = await assertVariantsInScope(db, lines.map((line) => line.variantId), scopeList.rows.map((row) => row.id));
  if (!lineScope.ok) return fail(lineScope.error, lineScope.status);

  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "opening", scope.entity.id, session?.email ?? null);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  const { data, error } = await db.rpc("post_opening_balance", {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_lines: lines.map((line) => ({ variantId: line.variantId, qty: Math.round(line.qty), unitCost: line.unitCost })),
    p_note: body.note?.trim() || null,
    p_actor: session?.email ?? null,
    p_occurred_at: body.occurredAt || null,
  });

  if (error) await releaseDocKey(db, docKey);
  if (error) {
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    if (error.message.includes("already has stock history")) return fail("У этого юрлица уже есть движения на складе — начальный остаток заводят один раз, для нового юрлица", 409);
    if (error.message.includes("belongs to a different legal entity")) return fail("Позиция принадлежит другому юрлицу", 400);
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    if (error.message.includes("has no lines")) return fail("Добавьте хотя бы одну позицию", 400);
    if (error.message.includes("quantity must be positive")) return fail("Количество должно быть больше нуля", 400);
    if (error.message.includes("unit cost")) return fail("Себестоимость не может быть отрицательной", 400);
    if (error.message.includes("date in the future")) return fail("Дата не может быть в будущем", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  const doc = await recordStockDoc(db, {
    kind: "opening",
    legalEntityId: scope.entity.id,
    warehouseId: body.warehouseId,
    targetWarehouseId: null,
    cabinetId: null,
    note: body.note?.trim() || null,
    result: data,
    actor: session?.email ?? null,
  });

  const result = (data ?? {}) as Record<string, unknown>;
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "opening_posted",
    refType: "stock_doc",
    refId: doc?.id ?? null,
    number: doc?.number ?? null,
    warehouseId: body.warehouseId,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: { qty: result.qty ?? null, amount: result.amount ?? null },
  });

  const payload = doc ? { ...result, docNumber: doc.number, docId: doc.id } : data;
  await settleDocKey(db, docKey, payload);
  return NextResponse.json({ data: payload, error: null }, { status: 201 });
}
