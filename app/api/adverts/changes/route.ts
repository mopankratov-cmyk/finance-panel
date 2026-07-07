import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface AdvertChange {
  id: number;
  advertId: number;
  oldBid: number | null;
  newBid: number | null;
  status: string;
  detail: string | null;
  createdAt: string;
}

// Найдено аудитом данных: раньше мёртвая заглушка {changes:[]} — таблица
// advert_bid_changes (журнал изменений ставок из app/api/adverts/bid/route.ts)
// уже пишется на каждую попытку смены ставки, просто читать её было некому.
// Заодно обнаружено и починено: миграция таблицы существовала в репо, но никогда
// не применялась к живой БД — каждая запись в лог тихо проваливалась.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ changes: [] });
  const { data, error } = await db.from("advert_bid_changes").select("id, advert_id, old_bid, new_bid, status, detail, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ changes: [], error: error.message });
  const changes: AdvertChange[] = (data ?? []).map((r) => ({
    id: r.id as number, advertId: r.advert_id as number,
    oldBid: r.old_bid == null ? null : Number(r.old_bid), newBid: r.new_bid == null ? null : Number(r.new_bid),
    status: r.status as string, detail: r.detail as string | null, createdAt: r.created_at as string,
  }));
  return NextResponse.json({ changes });
}
