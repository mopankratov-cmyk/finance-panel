import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import {
  mergePlanningBlock,
  normalizePlanningBlock,
  selectPlanningBlock,
  type PlanningState,
} from "@/lib/planning/state";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Контракт inferno: GET → {orders:[12], norms:{}, sku_orders:{art:[12]}}; POST сохраняет блок целиком.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const { cabinetId } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ orders: Array(12).fill(0), norms: {}, sku_orders: {} });
  const year = Number(params.get("year")) || new Date().getFullYear();
  const { data } = await db.from("planning_state").select("data").eq("year", year).maybeSingle();
  return NextResponse.json(selectPlanningBlock((data?.data ?? {}) as PlanningState, cabinetId));
}

export async function POST(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const { cabinetId } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const year = Number(b.year) || new Date().getFullYear();
  const block = normalizePlanningBlock({ orders: b.orders, norms: b.norms, sku_orders: b.sku_orders });
  const existing = await db.from("planning_state").select("data").eq("year", year).maybeSingle();
  const data = mergePlanningBlock((existing.data?.data ?? {}) as PlanningState, cabinetId, block);
  const { error } = await db
    .from("planning_state")
    .upsert({ year, data, updated_at: new Date().toISOString() }, { onConflict: "year" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
