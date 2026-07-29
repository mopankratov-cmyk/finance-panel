import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { disallowedPurchaseNmIds } from "@/lib/purchases/order";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

function sanitizeSnapshot(value: unknown, allowedNmIds: Set<number> | null): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = value as Record<string, unknown>;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.filter((item) => item && typeof item === "object" && requestAllowsNm(allowedNmIds, (item as Record<string, unknown>).nmId))
    : undefined;
  return items ? { ...snapshot, items } : snapshot;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  const generatedAt = new Date().toISOString();
  if (!db) return NextResponse.json({ meta: { cabinetId: "", generatedAt, status: "ready", warnings: [] }, data: null, error: "Supabase не настроен" }, { status: 500 });

  const { id } = await context.params;
  const { data: existing, error: findError } = await db.from("purchase_orders").select("cabinet_id, purchase_order_items(nm_id)").eq("id", id).maybeSingle();
  if (findError) return NextResponse.json({ meta: { cabinetId: "", generatedAt, status: "ready", warnings: [] }, data: null, error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ meta: { cabinetId: "", generatedAt, status: "ready", warnings: [] }, data: null, error: "Заказ не найден" }, { status: 404 });
  const cabinetId = String(existing.cabinet_id);
  const meta = { cabinetId, generatedAt, status: "ready" as const, warnings: [] as string[] };
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ meta, data: null, error: "Нет доступа к кабинету" }, { status: 403 });

  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const currentItems = (existing.purchase_order_items ?? []).map((item: { nm_id: number }) => ({ nmId: Number(item.nm_id) }));
  if (disallowedPurchaseNmIds(currentItems, allowedNmIds).length) return NextResponse.json({ meta, data: null, error: "Заказ не найден" }, { status: 404 });

  const { data, error } = await db.from("operation_audit_log")
    .select("id, action, actor, before_data, after_data, created_at")
    .eq("entity_type", "purchase_order")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ meta, data: null, error: error.message }, { status: 500 });

  const history = (data ?? []).map((entry) => ({
    id: entry.id,
    action: entry.action,
    actor: entry.actor,
    before: sanitizeSnapshot(entry.before_data, allowedNmIds),
    after: sanitizeSnapshot(entry.after_data, allowedNmIds),
    createdAt: entry.created_at,
  }));
  return NextResponse.json({ meta, data: { history }, error: null });
}
