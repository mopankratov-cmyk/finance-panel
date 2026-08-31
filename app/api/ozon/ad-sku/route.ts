import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { perfProductReport } from "@/lib/ozon/performance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 6 * 3600 * 1000;

// Per-SKU расход рекламы Ozon (кэш 6ч; обновление через async-отчёт Performance).
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const days = Math.min(30, Math.max(3, Number(sp.get("days")) || 14));
  const force = sp.get("force") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ bySku: {} });

  // Кабинет резолвим заранее — кэш рекламы скоупится по client_id (один Ozon Client-Id = один кабинет).
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ bySku: {}, noCabinet: true });
  const clientId = cab.creds.clientId;

  // 1) кэш (per-кабинет). Если миграция client_id ещё не применена — .eq упадёт, data=null → промах → свежий фетч.
  if (!force) {
    const { data } = await db.from("ozon_ad_cache").select("sku, spent, orders_money, updated_at").eq("days", days).eq("client_id", clientId);
    if (data?.length) {
      const fresh = data.every((r) => Date.now() - new Date(r.updated_at as string).getTime() < FRESH_MS);
      if (fresh) {
        const bySku: Record<string, { spent: number; ordersMoney: number }> = {};
        for (const r of data) bySku[r.sku as string] = { spent: Number(r.spent), ordersMoney: Number(r.orders_money) };
        return NextResponse.json({ bySku, cached: true });
      }
    }
  }

  // 2) обновление через Performance выбранного кабинета
  if (!cab.perf) return NextResponse.json({ bySku: {}, noPerf: true });
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const rep = await perfProductReport(cab.perf, from, to);
  if (!rep) return NextResponse.json({ bySku: {}, error: "Performance report failed" });

  // Частичный отчёт в кэш не кладём. Со свежей отметкой времени он выглядел
  // полным, и следующие шесть часов кабинет отдавал заниженный расход как
  // факт — незаметно, потому что цифра правдоподобная.
  const rows = rep.partial
    ? []
    : Object.entries(rep.bySku).map(([sku, v]) => ({ client_id: clientId, sku, days, spent: Math.round(v.spent), orders_money: Math.round(v.ordersMoney), updated_at: new Date().toISOString() }));
  if (rows.length) await db.from("ozon_ad_cache").upsert(rows, { onConflict: "client_id,sku,days" });

  return NextResponse.json({ bySku: rep.bySku, partial: rep.partial, refreshed: true });
}
