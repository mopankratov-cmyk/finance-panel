// Хранилище кодов маркировки сборочных заданий.
//
// WB отдаёт код по одному заданию за запрос, поэтому опрос всегда ограничен
// бюджетом. Раньше найденное складывалось в кэш Next — он не общий между
// роутами и умирает с каждой сборкой, так что прогресс терялся и «Сверка
// оборота» каждый раз начинала почти с нуля. База переживает и то, и другое.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Сколько задание считается «недавно опрошенным». Пустой ответ WB — это не
 * факт «кода нет»: продавец привяжет код позже. Но и спрашивать про одни и
 * те же задания при каждом заходе нельзя — тогда бюджет уходит на них, а до
 * остальных очередь не доходит вовсе.
 */
const PROBE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface KizCodeSnapshot {
  /** Найденные коды. Пусто — WB на момент опроса кода не отдал. */
  codes: Map<number, string[]>;
  /** Задания, которые опрашивались недавно и ещё не стоят нового запроса. */
  recentlyProbed: Set<number>;
}

/** Что уже известно по списку заданий. Ошибка чтения не мешает опросить WB. */
export async function loadKnownKizCodes(
  cabinetId: string,
  orderIds: number[],
): Promise<KizCodeSnapshot> {
  const snapshot: KizCodeSnapshot = { codes: new Map(), recentlyProbed: new Set() };
  if (!cabinetId || !orderIds.length) return snapshot;
  const db = getSupabaseAdmin();
  if (!db) return snapshot;
  const freshAfter = Date.now() - PROBE_COOLDOWN_MS;
  for (let index = 0; index < orderIds.length; index += 500) {
    const { data, error } = await db
      .from("wb_fbs_order_kiz")
      .select("order_id, codes, checked_at")
      .eq("cabinet_id", cabinetId)
      .in("order_id", orderIds.slice(index, index + 500));
    if (error || !data) return snapshot;
    for (const row of data) {
      const orderId = Number(row.order_id);
      const codes = Array.isArray(row.codes) ? row.codes.map(String).filter(Boolean) : [];
      if (codes.length) {
        snapshot.codes.set(orderId, codes);
        continue;
      }
      const checkedAt = Date.parse(String(row.checked_at ?? ""));
      if (Number.isFinite(checkedAt) && checkedAt > freshAfter) snapshot.recentlyProbed.add(orderId);
    }
  }
  return snapshot;
}

/**
 * Запомнить результат опроса — и найденный код, и пустой ответ.
 *
 * Пустой ответ пишется НЕ как «кода нет», а как отметка «спрашивали тогда-то»:
 * через PROBE_COOLDOWN_MS задание снова встанет в очередь. Без этой отметки
 * бюджет каждого захода уходил на одни и те же задания — счётчик стоял на
 * «120 из 598» и не двигался.
 */
export async function rememberKizCodes(
  cabinetId: string,
  probed: Map<number, string[]>,
): Promise<void> {
  if (!cabinetId || !probed.size) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const rows = [...probed.entries()].map(([orderId, codes]) => ({
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
