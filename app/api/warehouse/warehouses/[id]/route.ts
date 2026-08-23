import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { parseWarehouseKind } from "@/lib/warehouse/warehouseKind";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Переименование, смена типа и архивирование. Удаления нет: склад держит движения,
 *  и стереть его значило бы оборвать историю остатков. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { name?: string; kind?: string; note?: string; isActive?: boolean;
        entityId?: string; fbsSalesSince?: string | null }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);
  if (list.rows.length === 0) return fail("Нет доступных юрлиц", 403);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Дата списания продаж FBS — свойство пары «юрлицо + склад», а не склада:
  // склад общий, а доверять его остатку каждое юрлицо начинает со своей приёмки.
  if ("fbsSalesSince" in body) {
    if (!body.entityId || !list.rows.some((row) => row.id === body.entityId)) {
      return fail("Нет доступа к юрлицу", 403);
    }
    const since = body.fbsSalesSince ? new Date(body.fbsSalesSince) : null;
    if (since && Number.isNaN(since.getTime())) return fail("Некорректная дата", 400);
    const { error } = await db.from("legal_entity_warehouses").upsert({
      legal_entity_id: body.entityId,
      warehouse_id: id,
      fbs_sales_since: since ? since.toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "legal_entity_id,warehouse_id" });
    if (error) {
      const missing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "");
      return fail(missing ? "Примените миграцию 202608240019_fbs_sales.sql" : error.message, missing ? 503 : 500);
    }
    if (Object.keys(body).length === 2) {
      return NextResponse.json({ data: { id, fbsSalesSince: since ? since.toISOString() : null }, error: null });
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return fail("Название не может быть пустым", 400);
    patch.name = name;
  }
  if ("kind" in body) patch.kind = parseWarehouseKind(body.kind);
  if ("note" in body) patch.note = String(body.note ?? "").trim() || null;
  if ("isActive" in body) {
    patch.is_active = Boolean(body.isActive);
    if (!body.isActive) {
      // Склад с остатком в архив не уходит: товар физически на нём лежит, и спрятать
      // склад значило бы спрятать товар.
      const { data, error } = await db
        .from("stock_balances")
        .select("qty")
        .eq("warehouse_id", id)
        .neq("qty", 0)
        .limit(1);
      if (error) return fail(error.message, 500);
      if ((data ?? []).length > 0) return fail("На складе есть остаток — сначала отгрузите или спишите товар", 409);
    }
  }

  const { data, error } = await db
    .from("warehouses")
    .update(patch)
    .eq("id", id)
    .select("id, name, kind, is_active, position, note")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return fail("Склад с таким названием уже есть", 409);
    return fail(error.message, 500);
  }
  if (!data) return fail("Склад не найден", 404);

  return NextResponse.json({
    data: {
      id: data.id,
      name: data.name,
      kind: data.kind,
      isActive: data.is_active,
      position: data.position,
      note: data.note,
    },
    error: null,
  });
}
