import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { PURCHASE_ORDER_SELECT, purchaseOrderFromDb } from "@/lib/purchases/db";
import { disallowedPurchaseNmIds, normalizePurchaseOrderPayload } from "@/lib/purchases/order";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

const meta = (cabinetId: string, warnings: string[] = []) => ({
  cabinetId,
  generatedAt: new Date().toISOString(),
  status: "ready" as const,
  warnings,
});

function errorResponse(message: string, status: number, cabinetId = "") {
  return NextResponse.json({ meta: meta(cabinetId), data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }, cabinetId: string) {
  if (["42P01", "42883", "PGRST200", "PGRST202"].includes(error.code ?? "")) {
    return errorResponse("Контур заказов ещё не развёрнут: примените миграцию 20260713_purchase_orders.sql", 503, cabinetId);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500, cabinetId);
}

async function selectedCabinet(requested: string | null) {
  if (!requested || requested === "all") return null;
  const { cabinetId } = await resolveShopCabinet(requested);
  return cabinetId;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const requestedCabinet = new URL(request.url).searchParams.get("cabinet");
  if (!requestedCabinet || requestedCabinet === "all") return errorResponse("Выберите один реальный WB-кабинет", 400);
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const cabinetId = await selectedCabinet(requestedCabinet);
  if (!cabinetId) return errorResponse("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403, cabinetId);

  const [{ data, error }, allowedNmIds] = await Promise.all([
    db.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("cabinet_id", cabinetId).order("updated_at", { ascending: false }),
    requestAllowedNmIds(cabinetId),
  ]);
  if (error) return databaseError(error, cabinetId);

  const allOrders = (data ?? []).map((row) => purchaseOrderFromDb(row as Record<string, unknown>));
  const orders = allOrders.filter((order) => disallowedPurchaseNmIds(order.items, allowedNmIds).length === 0);
  const hidden = allOrders.length - orders.length;
  const warnings = hidden > 0 ? [`Скрыто заказов вне текущего товарного контура: ${hidden}`] : [];
  return NextResponse.json({ meta: meta(cabinetId, warnings), data: { orders }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);
  if (body.id) return errorResponse("Для изменения существующего заказа используйте PATCH", 400);
  const cabinetId = await selectedCabinet(typeof body.cabinetId === "string" ? body.cabinetId : null);
  if (!cabinetId) return errorResponse("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403, cabinetId);

  const normalized = normalizePurchaseOrderPayload(body, { cabinetId });
  if (!normalized.ok) return errorResponse(normalized.error, 400, cabinetId);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const disallowed = disallowedPurchaseNmIds(normalized.value.items, allowedNmIds);
  if (disallowed.length) return errorResponse(`Эти nmId не входят в разрешённый товарный контур: ${disallowed.join(", ")}`, 403, cabinetId);

  const session = await getServerSession();
  const { data: id, error } = await db.rpc("save_purchase_order", { p_order: normalized.value, p_actor: session?.email ?? null });
  if (error) return databaseError(error, cabinetId);

  const { data: row, error: readError } = await db.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("id", id).single();
  if (readError) return databaseError(readError, cabinetId);
  return NextResponse.json({ meta: meta(cabinetId), data: { order: purchaseOrderFromDb(row as Record<string, unknown>) }, error: null }, { status: 201 });
}
