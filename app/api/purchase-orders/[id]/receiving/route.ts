import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { disallowedPurchaseNmIds } from "@/lib/purchases/order";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  const generatedAt = new Date().toISOString();
  const makeMeta = (cabinetId: string) => ({ cabinetId, generatedAt, status: "ready" as const, warnings: [] as string[] });
  if (!db) return NextResponse.json({ meta: makeMeta(""), data: null, error: "Supabase не настроен" }, { status: 500 });

  const { id } = await context.params;
  const { data: existing, error: findError } = await db.from("purchase_orders").select("cabinet_id, purchase_order_items(nm_id)").eq("id", id).maybeSingle();
  if (findError) return NextResponse.json({ meta: makeMeta(""), data: null, error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ meta: makeMeta(""), data: null, error: "Заказ не найден" }, { status: 404 });
  const cabinetId = String(existing.cabinet_id);
  const meta = makeMeta(cabinetId);
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ meta, data: null, error: "Нет доступа к кабинету" }, { status: 403 });

  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const items = (existing.purchase_order_items ?? []).map((item: { nm_id: number }) => ({ nmId: Number(item.nm_id) }));
  const disallowed = disallowedPurchaseNmIds(items, allowedNmIds);
  if (disallowed.length) return NextResponse.json({ meta, data: null, error: "В заказе есть позиции вне разрешённого товарного контура" }, { status: 403 });

  const session = await getServerSession();
  const { data: batchId, error } = await db.rpc("create_purchase_order_receipt", { p_order_id: id, p_actor: session?.email ?? null });
  if (error) {
    const missing = ["42P01", "42883", "PGRST202"].includes(error.code ?? "");
    return NextResponse.json({ meta, data: null, error: missing ? "Контур заказов ещё не развёрнут: примените миграцию 20260713_purchase_orders.sql" : error.message }, { status: missing ? 503 : 400 });
  }
  return NextResponse.json({ meta, data: { batchId }, error: null });
}
