import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { SHIPMENT_SELECT, shipmentFromDb, type SupplierShipmentView } from "@/lib/purchases/shipmentsDb";
import { isOwnershipTransferred, type OwnershipTransferMoment } from "@/lib/purchases/supplierContracts";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Отгрузки ещё не развёрнуты: примените миграции 202609140006/0007_supplier_shipments*.sql", 503);
  }
  return errorResponse(error.message, 500);
}

export interface SupplierShipmentWithOrder extends SupplierShipmentView {
  orderNumber: string;
  supplier: string;
  /** §27.11 ТЗ: наступил ли момент перехода права собственности по договору
   *  для этой отгрузки. null — нет договора на пару (поставщик, юрлицо), или
   *  момент в договоре не позволяет решить однозначно ('other'). */
  ownershipTransferred: boolean | null;
}

/**
 * Сводка «Товар в пути» — по всем активным заказам кабинета сразу, не по
 * одному. planned/received/cancelled по умолчанию не показываем: это ещё не
 * в дороге и уже не в дороге, а экран как раз про то, что едет прямо сейчас.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const requestedCabinet = new URL(request.url).searchParams.get("cabinet");
  if (!requestedCabinet || requestedCabinet === "all") return errorResponse("Выберите один реальный кабинет", 400);
  const { cabinetId } = await resolveShopCabinet(requestedCabinet);
  if (!cabinetId) return errorResponse("Выберите один реальный кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);

  const includeAll = new URL(request.url).searchParams.get("all") === "1";
  let query = db
    .from("supplier_shipments")
    .select(`${SHIPMENT_SELECT}, purchase_orders!inner(cabinet_id, order_number, supplier, supplier_id)`)
    .eq("purchase_orders.cabinet_id", cabinetId)
    .order("eta", { ascending: true, nullsFirst: false });
  if (!includeAll) query = query.in("status", ["planned", "shipped", "customs", "arrived"]);

  const { data, error } = await query;
  if (error) return databaseError(error);

  const rows = (data ?? []) as Record<string, unknown>[];

  // Все отгрузки здесь — одного кабинета, значит и юрлицо у них одно и то
  // же: резолвим один раз, тем же путём, что и post_receipt_batch().
  const cabinetLink = await db
    .from("legal_entity_cabinets")
    .select("legal_entity_id")
    .eq("cabinet_id", cabinetId)
    .eq("relation", "own")
    .maybeSingle();
  const legalEntityId = cabinetLink.data?.legal_entity_id ? String(cabinetLink.data.legal_entity_id) : null;

  const supplierIds = [...new Set(rows
    .map((row) => (row.purchase_orders as Record<string, unknown> | null)?.supplier_id)
    .filter((value): value is string => typeof value === "string"))];

  const momentBySupplier = new Map<string, OwnershipTransferMoment>();
  if (legalEntityId && supplierIds.length > 0) {
    const contracts = await db
      .from("supplier_contracts")
      .select("supplier_id, ownership_transfer_moment, signed_at")
      .eq("legal_entity_id", legalEntityId)
      .eq("is_active", true)
      .in("supplier_id", supplierIds)
      // nullsFirst:false — иначе Postgres по умолчанию ставит NULL первым в
      // DESC, и договор без даты подписания всегда "выигрывал" бы у реально
      // более нового датированного (переподписание — как раз тот момент,
      // когда новый договор ещё не подписан/дата не введена).
      .order("signed_at", { ascending: false, nullsFirst: false });
    // Договоров может быть несколько при переподписании — берём самый
    // свежий по дате подписания (первое совпадение выигрывает, дальше строки
    // по тому же supplier_id пропускаются).
    for (const contract of contracts.data ?? []) {
      const supplierId = String(contract.supplier_id);
      if (!momentBySupplier.has(supplierId)) momentBySupplier.set(supplierId, contract.ownership_transfer_moment as OwnershipTransferMoment);
    }
  }

  const shipments: SupplierShipmentWithOrder[] = rows.map((record) => {
    const order = (record.purchase_orders ?? {}) as Record<string, unknown>;
    const supplierId = typeof order.supplier_id === "string" ? order.supplier_id : null;
    const moment = supplierId ? momentBySupplier.get(supplierId) ?? null : null;
    return {
      ...shipmentFromDb(record),
      orderNumber: typeof order.order_number === "string" ? order.order_number : "",
      supplier: typeof order.supplier === "string" ? order.supplier : "",
      ownershipTransferred: isOwnershipTransferred(moment, String(record.status ?? "")),
    };
  });
  return NextResponse.json({ data: { shipments }, error: null });
}
