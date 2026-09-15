import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSupplierContractPayload } from "@/lib/purchases/supplierContracts";
import { SUPPLIER_CONTRACT_SELECT, supplierContractFromDb } from "@/lib/purchases/supplierContractsDb";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "PGRST200", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Договоры ещё не развёрнуты: примените миграцию 202609151001_supplier_contracts.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

/** Выключение договора — не удаление: у него может стоять история отгрузок,
 *  на которые уже смотрел бейдж «наш товар». isActive: false просто убирает
 *  его из резолвинга нового бейджа и из выбора при переподписании. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);

  const normalized = normalizeSupplierContractPayload(body, { id });
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  const scope = await resolveEntity(normalized.value.legalEntityId);
  if (!scope.ok) return errorResponse(scope.error, scope.status);

  const { data: row, error } = await db
    .from("supplier_contracts")
    .update({
      supplier_id: normalized.value.supplierId,
      legal_entity_id: normalized.value.legalEntityId,
      number: normalized.value.number,
      signed_at: normalized.value.signedAt,
      currency: normalized.value.currency,
      prepayment_percent: normalized.value.prepaymentPercent,
      prepayment_terms: normalized.value.prepaymentTerms || null,
      final_payment_terms: normalized.value.finalPaymentTerms || null,
      production_days: normalized.value.productionDays,
      ownership_transfer_moment: normalized.value.ownershipTransferMoment,
      ownership_transfer_note: normalized.value.ownershipTransferNote || null,
      country_of_origin: normalized.value.countryOfOrigin || null,
      delivery_terms: normalized.value.deliveryTerms || null,
      transport_terms: normalized.value.transportTerms || null,
      customs_terms: normalized.value.customsTerms || null,
      is_active: normalized.value.isActive,
      note: normalized.value.note || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SUPPLIER_CONTRACT_SELECT)
    .maybeSingle();
  if (error) return databaseError(error);
  if (!row) return errorResponse("Договор не найден", 404);

  return NextResponse.json({ data: { contract: supplierContractFromDb(row as Record<string, unknown>) }, error: null });
}
