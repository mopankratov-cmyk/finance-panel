import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { PURCHASE_ORDER_SELECT, purchaseOrderFromDb } from "@/lib/purchases/db";
import { disallowedPurchaseNmIds, normalizePurchaseOrderPayload } from "@/lib/purchases/order";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

const meta = (cabinetId: string) => ({ cabinetId, generatedAt: new Date().toISOString(), status: "ready" as const, warnings: [] as string[] });
const fail = (message: string, status: number, cabinetId = "") => NextResponse.json({ meta: meta(cabinetId), data: null, error: message }, { status });

function databaseError(error: { code?: string; message: string }, cabinetId: string) {
  if (["42P01", "42883", "PGRST200", "PGRST202"].includes(error.code ?? "")) return fail("Контур заказов ещё не развёрнут: примените миграцию 20260713_purchase_orders.sql", 503, cabinetId);
  return fail(error.message, error.code === "23505" ? 409 : 500, cabinetId);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: existing, error: findError } = await db.from("purchase_orders").select("cabinet_id").eq("id", id).maybeSingle();
  if (findError) return databaseError(findError, "");
  if (!existing) return fail("Заказ не найден", 404);
  const cabinetId = String(existing.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId);

  const body = await request.json().catch(() => null);
  const normalized = normalizePurchaseOrderPayload(body, { id, cabinetId });
  if (!normalized.ok) return fail(normalized.error, 400, cabinetId);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const disallowed = disallowedPurchaseNmIds(normalized.value.items, allowedNmIds);
  if (disallowed.length) return fail(`Эти nmId не входят в разрешённый товарный контур: ${disallowed.join(", ")}`, 403, cabinetId);

  const session = await getServerSession();
  const { error } = await db.rpc("save_purchase_order", { p_order: normalized.value, p_actor: session?.email ?? null });
  if (error) return databaseError(error, cabinetId);

  const { data: row, error: readError } = await db.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("id", id).single();
  if (readError) return databaseError(readError, cabinetId);
  return NextResponse.json({ meta: meta(cabinetId), data: { order: purchaseOrderFromDb(row as Record<string, unknown>) }, error: null });
}
