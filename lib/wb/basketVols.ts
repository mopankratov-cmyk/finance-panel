// Серверный кэш «том WB → баскет».
//
// Живёт отдельным модулем, потому что lib/wb/cardImage.ts изоморфен: его
// синхронный wbCardImageUrl используют клиентские экраны, и тащить туда
// Supabase нельзя. Здесь же — только серверная часть.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/** Известные тома из базы. Ошибка чтения не мешает работе — просто опросим WB. */
export async function loadKnownBasketVols(vols: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!vols.length) return out;
  const db = getSupabaseAdmin();
  if (!db) return out;
  for (let index = 0; index < vols.length; index += 500) {
    const { data, error } = await db
      .from("wb_basket_vols")
      .select("vol, basket")
      .in("vol", vols.slice(index, index + 500));
    if (error || !data) return out;
    for (const row of data) out.set(Number(row.vol), Number(row.basket));
  }
  return out;
}

/** Запомнить найденные баскеты. Ошибка записи не должна ломать экран. */
export async function rememberBasketVols(found: Map<number, number>): Promise<void> {
  if (!found.size) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const rows = [...found.entries()]
    .filter(([, basket]) => basket > 0)
    .map(([vol, basket]) => ({ vol, basket, updated_at: new Date().toISOString() }));
  if (!rows.length) return;
  await db.from("wb_basket_vols").upsert(rows, { onConflict: "vol" });
}
