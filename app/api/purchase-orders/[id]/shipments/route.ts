import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { normalizeShipmentPayload } from "@/lib/purchases/shipments";
import { SHIPMENT_SELECT, shipmentFromDb } from "@/lib/purchases/shipmentsDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Отгрузки ещё не развёрнуты: примените миграции 202609140006/0007_supplier_shipments*.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

async function loadOrder(db: ReturnType<typeof getSupabaseAdmin>, id: string) {
  return db!.from("purchase_orders").select("cabinet_id, purchase_order_items(nm_id, article)").eq("id", id).maybeSingle();
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: order, error: findError } = await loadOrder(db, id);
  if (findError) return databaseError(findError);
  if (!order) return errorResponse("Заказ не найден", 404);
  const cabinetId = String(order.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);

  const { data, error } = await db.from("supplier_shipments").select(SHIPMENT_SELECT).eq("order_id", id).order("created_at", { ascending: true });
  if (error) return databaseError(error);
  return NextResponse.json({ data: { shipments: (data ?? []).map((row) => shipmentFromDb(row as Record<string, unknown>)) }, error: null });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: order, error: findError } = await loadOrder(db, id);
  if (findError) return databaseError(findError);
  if (!order) return errorResponse("Заказ не найден", 404);
  const cabinetId = String(order.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);
  if (body.id) return errorResponse("Для изменения существующей отгрузки используйте PATCH /api/supplier-shipments/[id]", 400);

  const normalized = normalizeShipmentPayload(body, { orderId: id });
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  const orderArticleByNmId = new Map((order.purchase_order_items ?? []).map((item: { nm_id: number; article: string }) => [Number(item.nm_id), item.article]));
  const foreign = normalized.value.items.filter((item) => !orderArticleByNmId.has(item.nmId)).map((item) => item.nmId);
  if (foreign.length) return errorResponse(`Этих позиций нет в заказе: ${foreign.join(", ")}`, 400);
  // Артикул берём из заказа, а не из тела запроса — иначе можно подписать
  // реальный nmId заказа чужим названием, и оно так и останется в отгрузке.
  const shipmentPayload = { ...normalized.value, items: normalized.value.items.map((item) => ({ ...item, article: orderArticleByNmId.get(item.nmId) ?? item.article })) };

  const session = await getServerSession();
  const { data: shipmentId, error } = await db.rpc("save_supplier_shipment", { p_shipment: shipmentPayload, p_actor: session?.email ?? null });
  if (error) return databaseError(error);

  const { data: row, error: readError } = await db.from("supplier_shipments").select(SHIPMENT_SELECT).eq("id", shipmentId).single();
  if (readError) return databaseError(readError);
  return NextResponse.json({ data: { shipment: shipmentFromDb(row as Record<string, unknown>) }, error: null }, { status: 201 });
}
