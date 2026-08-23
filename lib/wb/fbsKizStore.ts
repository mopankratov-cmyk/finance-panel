// Хранилище кодов маркировки сборочных заданий.
//
// WB отдаёт код по одному заданию за запрос, поэтому опрос всегда ограничен
// бюджетом. Раньше найденное складывалось в кэш Next — он не общий между
// роутами и умирает с каждой сборкой, так что прогресс терялся и «Сверка
// оборота» каждый раз начинала почти с нуля. База переживает и то, и другое.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/** Известные коды по списку заданий. Ошибка чтения не мешает опросить WB. */
export async function loadKnownKizCodes(
  cabinetId: string,
  orderIds: number[],
): Promise<Map<number, string[]>> {
  const known = new Map<number, string[]>();
  if (!cabinetId || !orderIds.length) return known;
  const db = getSupabaseAdmin();
  if (!db) return known;
  for (let index = 0; index < orderIds.length; index += 500) {
    const { data, error } = await db
      .from("wb_fbs_order_kiz")
      .select("order_id, codes")
      .eq("cabinet_id", cabinetId)
      .in("order_id", orderIds.slice(index, index + 500));
    if (error || !data) return known;
    for (const row of data) {
      const codes = Array.isArray(row.codes) ? row.codes.map(String).filter(Boolean) : [];
      if (codes.length) known.set(Number(row.order_id), codes);
    }
  }
  return known;
}

/**
 * Запомнить найденные коды. Пустой список не пишем: «кода нет» — состояние
 * сегодняшнего дня, продавец привяжет код позже, и запись держала бы это
 * как факт.
 */
export async function rememberKizCodes(
  cabinetId: string,
  found: Map<number, string[]>,
): Promise<void> {
  if (!cabinetId || !found.size) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const rows = [...found.entries()]
    .filter(([, codes]) => codes.length > 0)
    .map(([orderId, codes]) => ({
      cabinet_id: cabinetId,
      order_id: orderId,
      codes,
      checked_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += 500) {
    // Ошибку глотаем: не сохранили — просто опросим WB в следующий раз.
    await db.from("wb_fbs_order_kiz")
      .upsert(rows.slice(index, index + 500), { onConflict: "cabinet_id,order_id" });
  }
}
