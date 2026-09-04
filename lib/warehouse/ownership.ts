// Чей это товар, размер и склад.
//
// Модуль склада адресует объекты идентификаторами из адреса и тела запроса:
// товар, размер, партия, документ. Пока панелью пользовались только свои,
// проверки «а твоё ли это» хватало на уровне юрлица в самой операции. С
// приходом внешней компании этого мало: идентификатор чужой карточки можно
// подставить руками, и запись пойдёт мимо всех фильтров.
//
// Здесь одно место, которое отвечает на вопрос «принадлежит ли объект юрлицам,
// доступным этой сессии». Товар без юрлица считается общим: такие остались от
// импортов, и запрещать их всем значило бы сломать работу своих.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScopeFailure {
  ok: false;
  error: string;
  status: number;
}

export type ScopeResult = { ok: true } | ScopeFailure;

const FORBIDDEN = "Позиция принадлежит другому юрлицу";

/** Товары из списка обязаны принадлежать доступным юрлицам (или быть ничьими). */
export async function assertProductsInScope(
  db: SupabaseClient,
  productIds: string[],
  allowedEntityIds: string[],
): Promise<ScopeResult> {
  const ids = [...new Set(productIds.filter(Boolean).map(String))];
  if (ids.length === 0) return { ok: true };
  const { data, error } = await db.from("products").select("id, legal_entity_id").in("id", ids);
  if (error) return { ok: false, error: error.message, status: 500 };
  const rows = (data ?? []) as { id: string; legal_entity_id: string | null }[];
  if (rows.length !== ids.length) return { ok: false, error: "Товар не найден", status: 404 };
  const allowed = new Set(allowedEntityIds);
  for (const row of rows) {
    const owner = row.legal_entity_id ? String(row.legal_entity_id) : null;
    if (owner && !allowed.has(owner)) return { ok: false, error: FORBIDDEN, status: 403 };
  }
  return { ok: true };
}

/** То же для размеров: владелец у размера — юрлицо его модели. */
export async function assertVariantsInScope(
  db: SupabaseClient,
  variantIds: string[],
  allowedEntityIds: string[],
): Promise<ScopeResult> {
  const ids = [...new Set(variantIds.filter(Boolean).map(String))];
  if (ids.length === 0) return { ok: true };
  const { data, error } = await db.from("product_variants").select("id, product_id").in("id", ids);
  if (error) return { ok: false, error: error.message, status: 500 };
  const rows = (data ?? []) as { id: string; product_id: string }[];
  if (rows.length !== ids.length) return { ok: false, error: "Размер не найден", status: 404 };
  return assertProductsInScope(db, rows.map((row) => String(row.product_id)), allowedEntityIds);
}

/**
 * Склады, которые вправе видеть и трогать эта сессия.
 *
 * Для своих список общий: склад — место хранения, и на одном фулфилменте лежит
 * товар нескольких юрлиц. Для внешней компании — только те, где лежит её товар,
 * и те, что она завела сама: чужие названия ей знать незачем.
 */
export async function visibleWarehouseIds(
  db: SupabaseClient,
  options: { external: boolean; entityIds: string[]; actor: string | null },
): Promise<Set<string> | null> {
  if (!options.external) return null;
  const own = new Set<string>();
  if (options.entityIds.length > 0) {
    const used = await db
      .from("stock_moves")
      .select("warehouse_id")
      .in("legal_entity_id", options.entityIds)
      .limit(5000);
    for (const row of used.data ?? []) own.add(String(row.warehouse_id));
    const planned = await db
      .from("stock_docs")
      .select("warehouse_id")
      .in("legal_entity_id", options.entityIds)
      .not("warehouse_id", "is", null)
      .limit(2000);
    for (const row of planned.data ?? []) own.add(String(row.warehouse_id));
  }
  if (options.actor) {
    const mine = await db.from("warehouses").select("id").eq("created_by", options.actor);
    for (const row of mine.data ?? []) own.add(String(row.id));
  }
  return own;
}
