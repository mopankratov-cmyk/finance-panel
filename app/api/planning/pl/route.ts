import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Контракт inferno: GET → {orders:[12], norms:{}, sku_orders:{art:[12]}}; POST сохраняет блок целиком.
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ orders: Array(12).fill(0), norms: {}, sku_orders: {} });
  const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear();
  const { data } = await db.from("planning_state").select("data").eq("year", year).maybeSingle();
  const d = (data?.data ?? {}) as { orders?: number[]; norms?: Record<string, unknown>; sku_orders?: Record<string, number[]> };
  return NextResponse.json({
    orders: Array.isArray(d.orders) && d.orders.length === 12 ? d.orders : Array(12).fill(0),
    norms: d.norms ?? {},
    sku_orders: d.sku_orders ?? {},
  });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const year = Number(b.year) || new Date().getFullYear();
  const data = { orders: b.orders ?? [], norms: b.norms ?? {}, sku_orders: b.sku_orders ?? {} };
  const { error } = await db
    .from("planning_state")
    .upsert({ year, data, updated_at: new Date().toISOString() }, { onConflict: "year" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
