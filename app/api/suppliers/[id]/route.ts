import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSupplierPayload } from "@/lib/purchases/suppliers";
import { SUPPLIER_SELECT, supplierFromDb } from "@/lib/purchases/suppliersDb";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "PGRST200", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Справочник поставщиков ещё не развёрнут: примените миграцию 202609140003_suppliers.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

/**
 * Выключение поставщика — не удаление (§ note в миграции): у него может
 * стоять история заказов, ссылка supplier_id жива. `isActive: false` просто
 * убирает его из списка выбора для нового заказа.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);

  const normalized = normalizeSupplierPayload(body, { id });
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  const { data: row, error } = await db
    .from("suppliers")
    .update({
      name: normalized.value.name,
      country: normalized.value.country || null,
      tax_id: normalized.value.taxId || null,
      currency: normalized.value.currency,
      production_days: normalized.value.productionDays,
      min_order_qty: normalized.value.minOrderQty,
      contact_name: normalized.value.contactName || null,
      contact_phone: normalized.value.contactPhone || null,
      note: normalized.value.note || null,
      is_active: normalized.value.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SUPPLIER_SELECT)
    .maybeSingle();
  if (error) return databaseError(error);
  if (!row) return errorResponse("Поставщик не найден", 404);

  return NextResponse.json({ data: { supplier: supplierFromDb(row as Record<string, unknown>) }, error: null });
}
