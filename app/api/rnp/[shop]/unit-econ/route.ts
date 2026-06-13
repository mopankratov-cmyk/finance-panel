import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow { nm_id: number; article: string; orders_month: number; orders_sum_month: number; cost: number | null }

// Юнит-экономика по SKU для режима планирования РНП. {econ:{<nm>:{cost,price,margin}}}.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ econ: {} });
  const { data } = await db.rpc("rnp_report");
  const econ: Record<string, { cost: number; price: number; margin: number | null }> = {};
  for (const r of (data ?? []) as RpcRow[]) {
    const orders = r.orders_month || 0;
    const price = orders > 0 ? Math.round(Number(r.orders_sum_month || 0) / orders) : 0;
    const cost = Math.round(Number(r.cost ?? 0));
    econ[String(r.nm_id)] = {
      cost,
      price,
      margin: price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null,
    };
  }
  return NextResponse.json({ econ });
}
