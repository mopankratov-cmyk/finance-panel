import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

export const dynamic = "force-dynamic";

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
}

export interface PriceRow {
  article: string;
  nmId: number;
  avgPrice: number;
}

// Данные для шаблона обновления цен: текущая средняя цена продажи по SKU.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  let data: RpcRow[];
  try {
    data = await loadRnpReportRows<RpcRow>(db, null, { label: "Цены WB: товары" });
  } catch (error) {
    return NextResponse.json({ data: null, error: error instanceof Error ? error.message : "Не удалось загрузить товары WB" }, { status: 500 });
  }

  const rows: PriceRow[] = data
    .map((r) => ({
      article: r.article || String(r.nm_id),
      nmId: r.nm_id,
      avgPrice: r.orders_month > 0 ? Math.round(Number(r.orders_sum_month) / r.orders_month) : 0,
    }))
    .sort((a, b) => a.article.localeCompare(b.article));
  return NextResponse.json({ data: rows, error: null });
}
