import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSupplierContractPayload } from "@/lib/purchases/supplierContracts";
import { SUPPLIER_CONTRACT_SELECT, supplierContractFromDb } from "@/lib/purchases/supplierContractsDb";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

/**
 * Договоры (§4.3, §27.11 ТЗ) — пара (поставщик, юрлицо), не сам поставщик:
 * один поставщик может шить на несколько наших юрлиц одновременно, каждое
 * со своими условиями и моментом перехода права собственности.
 */

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "PGRST200", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Договоры ещё не развёрнуты: примените миграцию 202609151001_supplier_contracts.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const supplierId = new URL(request.url).searchParams.get("supplierId");

  // nullsFirst:false — см. app/api/supplier-shipments/route.ts: договор без
  // даты подписания не должен обгонять датированный в списке.
  let query = db.from("supplier_contracts").select(SUPPLIER_CONTRACT_SELECT).order("signed_at", { ascending: false, nullsFirst: false });
  if (supplierId) query = query.eq("supplier_id", supplierId);
  const { data, error } = await query;
  if (error) return databaseError(error);

  return NextResponse.json({ data: { contracts: (data ?? []).map((row) => supplierContractFromDb(row as Record<string, unknown>)) }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);
  if (body.id) return errorResponse("Для изменения существующего договора используйте PATCH /api/supplier-contracts/[id]", 400);

  const normalized = normalizeSupplierContractPayload(body);
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  // purchase.manage сегодня выдан только director/buyer (обе роли видят все
  // юрлица компании), так что это не закрывает реальную дыру прав — но даёт
  // чистый 4xx вместо сырой FK-ошибки на мусорном legal_entity_id, и держит
  // тот же паттерн, что и складские роуты (resolveEntity перед доверием телу).
  const scope = await resolveEntity(normalized.value.legalEntityId);
  if (!scope.ok) return errorResponse(scope.error, scope.status);

  const session = await getServerSession();
  const { data: row, error } = await db
    .from("supplier_contracts")
    .insert({
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
      created_by: session?.email ?? null,
    })
    .select(SUPPLIER_CONTRACT_SELECT)
    .single();
  if (error) return databaseError(error);

  return NextResponse.json({ data: { contract: supplierContractFromDb(row as Record<string, unknown>) }, error: null }, { status: 201 });
}
