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

/* ───────────────────────────── возвраты из базы ───────────────────────────── */

export interface StoredReturnFact {
  saleId: string;
  srid: string;
  nmId: number | null;
  article: string;
  barcode: string;
  brand: string;
  returnedAt: string | null;
}

/**
 * Возвраты из своей базы вместо живого запроса к статистике WB.
 *
 * У статистики лимит один запрос в минуту на продавца, и на агентской Оптиме
 * экран сверки стабильно получал «WB ограничил частоту (продажи и возвраты)»
 * — раздел возвратов оставался пустым. При этом продажи синкаются ежечасно
 * ВМЕСТЕ с возвратами (saleID на «R…»), не хватало только srid.
 *
 * Возвращает null, когда прочитать из базы нельзя — колонки ещё нет или srid
 * не заполнен. Тогда вызывающий честно идёт к WB, а не показывает пустоту.
 */
export async function loadReturnFactsFromDb(
  cabinetId: string,
  fromIso: string,
): Promise<StoredReturnFact[] | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from("wb_sales")
    .select("sale_id, srid, nm_id, date")
    .eq("cabinet_id", cabinetId)
    .gte("date", fromIso)
    .like("sale_id", "R%")
    .limit(20_000);

  // Колонки ещё нет — миграция не применена.
  if (error) return null;
  if (!data?.length) return [];

  const withSrid = data.filter((row) => String(row.srid ?? "").trim());
  // Строки есть, а srid пуст — синк ещё не дошёл до этих дат. Показывать
  // пустой раздел нельзя: это выглядело бы как «возвратов не было».
  if (!withSrid.length) return null;

  const nmIds = [...new Set(withSrid.map((row) => Number(row.nm_id)).filter(Number.isFinite))];
  const cards = new Map<number, { article: string; brand: string }>();
  for (let index = 0; index < nmIds.length; index += 500) {
    const { data: chunk } = await db
      .from("wb_cards")
      .select("nm_id, article, brand")
      .eq("cabinet_id", cabinetId)
      .in("nm_id", nmIds.slice(index, index + 500));
    for (const card of chunk ?? []) {
      cards.set(Number(card.nm_id), {
        article: String(card.article ?? ""),
        brand: String(card.brand ?? ""),
      });
    }
  }

  return withSrid.map((row) => {
    const nmId = Number(row.nm_id);
    const card = cards.get(nmId);
    return {
      saleId: String(row.sale_id ?? ""),
      srid: String(row.srid ?? "").trim(),
      nmId: Number.isFinite(nmId) ? nmId : null,
      article: card?.article ?? "",
      // Баркод в сверке не участвует: сопоставление идёт по srid.
      barcode: "",
      brand: card?.brand ?? "",
      returnedAt: row.date ? String(row.date).slice(0, 10) : null,
    };
  });
}

/**
 * Очередь заданий из своей базы вместо выкачивания списка у WB.
 *
 * Синк fbs-orders уже сохраняет задания кабинета — и, в отличие от WB,
 * только СВОИ: чужие он отсекает по товарному контуру ещё при записи. Значит
 * фоновому сборщику незачем каждые 15 минут качать у WB список, где на 304
 * своих задания приходится 3696 чужих.
 *
 * Возвращает null, если колонки order_id ещё нет или она не заполнена —
 * тогда вызывающий работает по-старому, через список WB.
 */
export async function loadOrderIdsFromDb(
  cabinetId: string,
  fromMs: number,
  toMs: number,
  limit: number,
): Promise<number[] | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from("wb_fbs_orders")
    .select("order_id")
    .eq("cabinet_id", cabinetId)
    .gte("created_at_wb", new Date(fromMs).toISOString())
    .lt("created_at_wb", new Date(toMs).toISOString())
    .not("order_id", "is", null)
    .limit(limit);

  if (error) return null;
  const ids = (data ?? [])
    .map((row) => Number(row.order_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  // Пусто — синк по этим датам ещё не прошёл; честнее спросить WB, чем
  // сделать вид, что заданий не было.
  return ids.length ? ids : null;
}

/* ────────────────────── сборочные задания из базы ────────────────────── */

export interface StoredAssemblyTask {
  id: number;
  srid: string;
  nmId: number | null;
  article: string;
  barcode: string;
  createdAt: string | null;
}

/**
 * Сборочные задания из своей базы вместо выкачивания списка у WB.
 *
 * Экран сверки держал список в unstable_cache — кэше, который не общий между
 * роутами и умирает с каждой сборкой. После любого деплоя экран заново качал
 * у WB 20 000 заданий (на агентском кабинете свои среди них — 304), и обычное
 * открытие страницы упиралось в «WB ограничил частоту».
 *
 * Синк fbs-orders хранит те же задания и только свои — отсев по товарному
 * контуру он делает ещё при записи.
 *
 * Возвращает null, если читать нельзя: колонок нет, они не заполнены или в
 * окне вовсе ничего не нашлось. Тогда вызывающий идёт к WB — пустая база не
 * должна выдаваться за «заданий не было».
 */
export async function loadAssemblyTasksFromDb(
  cabinetId: string,
  fromMs: number,
  toMs: number,
  limit: number,
): Promise<StoredAssemblyTask[] | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from("wb_fbs_orders")
    .select("order_id, srid, nm_id, article, barcode, created_at_wb")
    .eq("cabinet_id", cabinetId)
    .gte("created_at_wb", new Date(fromMs).toISOString())
    .lt("created_at_wb", new Date(toMs).toISOString())
    .not("order_id", "is", null)
    .limit(limit);

  if (error || !data?.length) return null;

  const tasks: StoredAssemblyTask[] = [];
  for (const row of data) {
    const id = Number(row.order_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    // Баркод участвует в сопоставлении кода с товаром: строка без него
    // соврала бы «код не подходит». Такие задания оставляем спросить у WB.
    if (!String(row.barcode ?? "").trim()) return null;
    const nmId = Number(row.nm_id);
    tasks.push({
      id,
      srid: String(row.srid ?? "").trim(),
      nmId: Number.isFinite(nmId) ? nmId : null,
      article: String(row.article ?? "").trim(),
      barcode: String(row.barcode ?? "").trim(),
      createdAt: row.created_at_wb ? String(row.created_at_wb) : null,
    });
  }
  return tasks.length ? tasks : null;
}
