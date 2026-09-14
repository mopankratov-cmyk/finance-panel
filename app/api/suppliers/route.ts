import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSupplierPayload } from "@/lib/purchases/suppliers";
import { SUPPLIER_SELECT, supplierFromDb } from "@/lib/purchases/suppliersDb";

export const dynamic = "force-dynamic";

/**
 * Справочник поставщиков — общий на компанию, не по кабинету и не по юрлицу.
 *
 * Гейт прав держит только это: `purchase.manage` у закупщика и руководителя
 * (см. lib/auth/apiPermissions.ts), кабинет ни при чём — тот же поставщик
 * шьёт для нескольких юрлиц сразу, привязка к конкретной паре живёт в
 * договоре, а не в самом справочнике.
 */

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "PGRST200", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Справочник поставщиков ещё не развёрнут: примените миграцию 202609140003_suppliers.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { data, error } = await db.from("suppliers").select(SUPPLIER_SELECT).order("name", { ascending: true });
  if (error) return databaseError(error);

  return NextResponse.json({ data: { suppliers: (data ?? []).map((row) => supplierFromDb(row as Record<string, unknown>)) }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);
  if (body.id) return errorResponse("Для изменения существующего поставщика используйте PATCH /api/suppliers/[id]", 400);

  const normalized = normalizeSupplierPayload(body);
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  const session = await getServerSession();
  const { data: row, error } = await db
    .from("suppliers")
    .insert({
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
      created_by: session?.email ?? null,
    })
    .select(SUPPLIER_SELECT)
    .single();
  if (error) return databaseError(error);

  return NextResponse.json({ data: { supplier: supplierFromDb(row as Record<string, unknown>) }, error: null }, { status: 201 });
}
