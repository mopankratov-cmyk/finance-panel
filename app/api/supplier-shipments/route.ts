import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { SHIPMENT_SELECT, shipmentFromDb, type SupplierShipmentView } from "@/lib/purchases/shipmentsDb";
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
    .select(`${SHIPMENT_SELECT}, purchase_orders!inner(cabinet_id, order_number, supplier)`)
    .eq("purchase_orders.cabinet_id", cabinetId)
    .order("eta", { ascending: true, nullsFirst: false });
  if (!includeAll) query = query.in("status", ["planned", "shipped", "customs", "arrived"]);

  const { data, error } = await query;
  if (error) return databaseError(error);

  const shipments: SupplierShipmentWithOrder[] = (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const order = (record.purchase_orders ?? {}) as Record<string, unknown>;
    return {
      ...shipmentFromDb(record),
      orderNumber: typeof order.order_number === "string" ? order.order_number : "",
      supplier: typeof order.supplier === "string" ? order.supplier : "",
    };
  });
  return NextResponse.json({ data: { shipments }, error: null });
}
