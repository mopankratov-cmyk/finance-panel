// Кухня заданий на отгрузку — общая для роутов /api/warehouse/tasks*.
//
// Route-файл Next экспортирует только обработчики, а строку ShipmentTaskRow
// собирают три роута: список (GET /tasks), создание (POST /tasks) и правка
// (PATCH /tasks/[id]). Модуль лежит рядом с ними, а не в lib/warehouse: это не
// библиотека склада, а внутренности одного экрана — подписи размеров, остаток
// на складе задания и «доступно» с учётом чужих черновиков.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import {
  reservationKey,
  reservedByVariant,
  type ShipmentTaskLine,
  type ShipmentTaskRow,
  type ShipmentTaskStatus,
} from "@/lib/warehouse/tasks";

export const MIGRATION_HINT =
  "Примените миграции 202609040002_warehouse_flow.sql и 202609040003_warehouse_flow_functions.sql";

/** «Таблицы / колонки / функции нет» — миграция ещё не применена. Новые роуты
 *  отвечают на это 503 с подсказкой, а не пятисоткой без объяснения. */
export const isMissingMigration = (code?: string | null): boolean =>
  ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");

export const TASK_DOC_COLUMNS =
  "id, number, kind, status, legal_entity_id, warehouse_id, cabinet_id, note, occurred_at, created_at, created_by, confirmed_at, confirmed_by, result, reverses";

export const TASK_LINE_COLUMNS = "id, doc_id, variant_id, product_id, cabinet_id, qty, shipped_qty";

export interface TaskDoc {
  id: string;
  number: string;
  kind: string;
  status: string;
  legal_entity_id: string;
  warehouse_id: string | null;
  cabinet_id: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  result: Record<string, unknown> | null;
  reverses: string | null;
}

export interface TaskDocLine {
  id: number;
  doc_id: string;
  variant_id: string;
  product_id: string;
  cabinet_id: string | null;
  qty: number;
  shipped_qty: number | null;
}

export interface DbError {
  message: string;
  code?: string;
}

interface DbPage<Row> {
  data: Row[] | null;
  error: DbError | null;
}

/** `.in()` по сотням идентификаторов не влезает в URL, а ответ без range
 *  PostgREST молча режет на тысяче строк — поэтому кусками. */
export async function chunked<Row>(
  ids: string[],
  load: (chunk: string[]) => PromiseLike<DbPage<Row>>,
  size = 150,
): Promise<{ rows: Row[]; error: DbError | null }> {
  const rows: Row[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let index = 0; index < unique.length; index += size) {
    const result = await load(unique.slice(index, index + size));
    if (result.error) return { rows, error: result.error };
    rows.push(...(result.data ?? []));
  }
  return { rows, error: null };
}

export async function loadTaskLines(
  db: SupabaseClient,
  docIds: string[],
): Promise<{ rows: TaskDocLine[]; error: DbError | null }> {
  return chunked<TaskDocLine>(
    docIds,
    (chunk) => db.from("stock_doc_lines").select(TASK_LINE_COLUMNS).in("doc_id", chunk).order("id"),
    100,
  );
}

export interface VariantInfo {
  id: string;
  productId: string;
  sizeLabel: string;
  barcode: string | null;
  article: string;
  nmId: number | null;
  photoUrl: string | null;
}

/** Размер вместе с товаром: подпись «NV-836-04 · 42», баркод для сканера, фото. */
export async function loadVariantCatalog(
  db: SupabaseClient,
  variantIds: string[],
): Promise<{ variants: Map<string, VariantInfo>; error: DbError | null }> {
  const variants = new Map<string, VariantInfo>();
  if (variantIds.length === 0) return { variants, error: null };

  const variantsResult = await chunked<{ id: string; product_id: string; size_label: string | null; barcode: string | null }>(
    variantIds,
    (chunk) => db.from("product_variants").select("id, product_id, size_label, barcode").in("id", chunk),
  );
  if (variantsResult.error) return { variants, error: variantsResult.error };

  const productsResult = await chunked<{ id: string; article: string | null; nm_id: number | null; photo_url: string | null }>(
    variantsResult.rows.map((row) => String(row.product_id)),
    (chunk) => db.from("products").select("id, article, nm_id, photo_url").in("id", chunk),
  );
  if (productsResult.error) return { variants, error: productsResult.error };
  const products = new Map(productsResult.rows.map((row) => [String(row.id), row]));

  for (const row of variantsResult.rows) {
    const product = products.get(String(row.product_id));
    variants.set(String(row.id), {
      id: String(row.id),
      productId: String(row.product_id),
      sizeLabel: String(row.size_label ?? ""),
      barcode: row.barcode ?? null,
      article: String(product?.article ?? ""),
      nmId: product?.nm_id === null || product?.nm_id === undefined ? null : Number(product.nm_id),
      photoUrl: product?.photo_url ?? null,
    });
  }
  return { variants, error: null };
}

/** Остаток по размерам, ключ — «склад:размер». Склад можно не задавать: тогда
 *  по всем складам юрлица, и строка задания найдёт свой по ключу. */
async function loadOnHand(
  db: SupabaseClient,
  entityId: string,
  variantIds: string[],
  warehouseId: string | null,
): Promise<{ onHand: Map<string, number>; error: DbError | null }> {
  const onHand = new Map<string, number>();
  const result = await chunked<{ warehouse_id: string; variant_id: string; qty: number }>(variantIds, (chunk) => {
    let query = db
      .from("stock_balances")
      .select("warehouse_id, variant_id, qty")
      .eq("legal_entity_id", entityId)
      .in("variant_id", chunk);
    if (warehouseId) query = query.eq("warehouse_id", warehouseId);
    return query;
  });
  if (result.error) return { onHand, error: result.error };
  for (const row of result.rows) {
    const key = reservationKey(String(row.warehouse_id), String(row.variant_id));
    onHand.set(key, (onHand.get(key) ?? 0) + Number(row.qty));
  }
  return { onHand, error: null };
}

/**
 * Доступно к заданию: остаток на складе минус резерв ЧУЖИХ черновиков на нём же.
 * Своё задание при правке из резерва исключается — иначе оно спорило бы само с
 * собой и не давало бы даже уменьшить количество.
 */
export async function loadAvailable(
  db: SupabaseClient,
  entityId: string,
  warehouseId: string,
  variantIds: string[],
  excludeDocId: string | null,
): Promise<{ available: Map<string, number>; error: DbError | null }> {
  const available = new Map<string, number>();
  const stock = await loadOnHand(db, entityId, variantIds, warehouseId);
  if (stock.error) return { available, error: stock.error };

  let drafts = db
    .from("stock_docs")
    .select("id")
    .eq("legal_entity_id", entityId)
    .eq("kind", "shipment")
    .eq("status", "draft")
    .eq("warehouse_id", warehouseId);
  if (excludeDocId) drafts = drafts.neq("id", excludeDocId);
  const draftsResult = await drafts;
  if (draftsResult.error) return { available, error: draftsResult.error };

  const lines = await loadTaskLines(db, (draftsResult.data ?? []).map((row) => String(row.id)));
  if (lines.error) return { available, error: lines.error };
  const reserved = reservedByVariant(
    lines.rows.map((line) => ({ warehouseId, variantId: String(line.variant_id), qty: Number(line.qty) })),
  );

  for (const variantId of new Set(variantIds)) {
    const key = reservationKey(warehouseId, variantId);
    available.set(variantId, (stock.onHand.get(key) ?? 0) - (reserved.get(key) ?? 0));
  }
  return { available, error: null };
}

export const toTaskStatus = (value: unknown): ShipmentTaskStatus =>
  value === "draft" || value === "cancelled" || value === "reversed" ? value : "posted";

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Строки заданий по документам и их строкам — как их видит экран. */
export async function buildTaskRows(
  db: SupabaseClient,
  entity: LegalEntityRow,
  docs: TaskDoc[],
  lines: TaskDocLine[],
  warehouseNames: Map<string, string>,
): Promise<{ rows: ShipmentTaskRow[]; error: DbError | null }> {
  const variantIds = [...new Set(lines.map((line) => String(line.variant_id)))];
  const catalog = await loadVariantCatalog(db, variantIds);
  if (catalog.error) return { rows: [], error: catalog.error };
  const stock = await loadOnHand(db, entity.id, variantIds, null);
  if (stock.error) return { rows: [], error: stock.error };

  const cabinets = new Map(entity.cabinets.map((link) => [link.cabinetId, link]));
  const byDoc = new Map<string, TaskDocLine[]>();
  for (const line of lines) {
    const list = byDoc.get(String(line.doc_id)) ?? [];
    list.push(line);
    byDoc.set(String(line.doc_id), list);
  }

  const rows: ShipmentTaskRow[] = docs.map((doc) => {
    const warehouseId = doc.warehouse_id ? String(doc.warehouse_id) : null;
    const cabinet = doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) : undefined;
    const status = toTaskStatus(doc.status);

    const taskLines: ShipmentTaskLine[] = (byDoc.get(String(doc.id)) ?? []).map((line) => {
      const info = catalog.variants.get(String(line.variant_id));
      return {
        id: Number(line.id),
        variantId: String(line.variant_id),
        productId: String(line.product_id),
        article: info?.article ?? "",
        sizeLabel: info?.sizeLabel ?? "",
        barcode: info?.barcode ?? null,
        nmId: info?.nmId ?? null,
        photoUrl: info?.photoUrl ?? null,
        qty: Number(line.qty),
        shippedQty: line.shipped_qty === null || line.shipped_qty === undefined ? null : Number(line.shipped_qty),
        onHand: warehouseId ? stock.onHand.get(reservationKey(warehouseId, String(line.variant_id))) ?? 0 : 0,
      };
    });
    const shipped = taskLines.filter((line) => line.shippedQty !== null);

    return {
      id: String(doc.id),
      number: String(doc.number),
      status,
      warehouseId,
      warehouseName: warehouseId ? warehouseNames.get(warehouseId) ?? "склад удалён" : null,
      cabinetId: doc.cabinet_id ? String(doc.cabinet_id) : null,
      cabinetName: doc.cabinet_id ? cabinet?.cabinetName ?? "кабинет" : null,
      marketplace: cabinet?.marketplace ?? null,
      note: doc.note ?? null,
      createdAt: String(doc.created_at),
      createdBy: doc.created_by ?? null,
      confirmedAt: doc.confirmed_at ?? null,
      confirmedBy: doc.confirmed_by ?? null,
      occurredAt: String(doc.occurred_at),
      qty: taskLines.reduce((sum, line) => sum + line.qty, 0),
      shippedQty: shipped.length > 0 ? shipped.reduce((sum, line) => sum + (line.shippedQty ?? 0), 0) : null,
      // Сумма есть только у проведённого: её посчитала проводка по себестоимости.
      amount: status === "draft" || status === "cancelled" ? null : num(doc.result?.amount),
      lines: taskLines,
    };
  });

  return { rows, error: null };
}

/** Черновики первыми — свежие сверху; выполненные и отменённые — по дате документа. */
export function sortTaskRows(rows: ShipmentTaskRow[]): ShipmentTaskRow[] {
  return rows.slice().sort((a, b) => {
    const draftA = a.status === "draft" ? 0 : 1;
    const draftB = b.status === "draft" ? 0 : 1;
    if (draftA !== draftB) return draftA - draftB;
    return draftA === 0
      ? b.createdAt.localeCompare(a.createdAt)
      : b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt);
  });
}

/** Строки из тела запроса: без размера и с нулём — мимо, дубли по размеру складываются. */
export function mergeLineInputs(
  raw: { variantId?: string; qty?: number | string }[] | null | undefined,
): { variantId: string; qty: number }[] {
  const merged = new Map<string, number>();
  for (const line of raw ?? []) {
    const variantId = typeof line?.variantId === "string" ? line.variantId.trim() : "";
    const qty = Math.round(Number(line?.qty));
    if (!variantId || !Number.isFinite(qty) || qty <= 0) continue;
    merged.set(variantId, (merged.get(variantId) ?? 0) + qty);
  }
  return [...merged.entries()].map(([variantId, qty]) => ({ variantId, qty }));
}
