import { notFound } from "next/navigation";
import { PrintableDoc } from "@/components/warehouse/PrintableDoc";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { isMissingColumn } from "@/lib/warehouse/productRow";
import type { StockDocDetail, StockDocLine } from "@/app/api/warehouse/docs/[id]/route";
import type { StockDocKind } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

const COLUMNS_LEGACY = "id, number, kind, status, legal_entity_id, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, movement_doc_id, created_by, reversed_by, reverses";
// Колонки миграции 202609040002 — до неё их нет, и бумага печатается без них.
const COLUMNS = `${COLUMNS_LEGACY}, confirmed_at, confirmed_by`;

const toStatus = (value: unknown): StockDocDetail["status"] =>
  value === "draft" || value === "reversed" || value === "cancelled" ? value : "posted";

/**
 * Печатная форма документа.
 *
 * Отдельная страница, а не модалка: со сторонним фулфилментом нужна бумага под
 * подпись, а печатать модалку поверх приложения — значит печатать и приложение.
 * Данные читаются на сервере тем же путём, что и карточка: строки документа —
 * это его движения в регистре, другого источника нет и не должно быть. Одно
 * исключение — задание (черновик): движений ещё нет, и бумага для фулфилмента
 * нужна именно до того, как товар уехал, — строки берутся из stock_doc_lines.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await listAccessibleEntities();
  const db = getSupabaseAdmin();
  if (!list.ok || !db) notFound();

  const query = (columns: string) => db.from("stock_docs").select(columns).eq("id", id).maybeSingle();
  let docResult = await query(COLUMNS);
  if (docResult.error && isMissingColumn(docResult.error.code)) docResult = await query(COLUMNS_LEGACY);
  const doc = docResult.data as unknown as Record<string, unknown> | null;
  if (!doc) notFound();

  const entity = list.rows.find((row) => row.id === String(doc.legal_entity_id));
  if (!entity) notFound();

  const warehouses = await db.from("warehouses").select("id, name");
  const names = new Map((warehouses.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinets = new Map(entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  const sizesFor = async (variantIds: string[]) => {
    const sizes = new Map<string, { size: string; barcode: string | null }>();
    if (variantIds.length === 0) return sizes;
    const variants = await db.from("product_variants").select("id, size_label, barcode").in("id", variantIds);
    for (const row of variants.data ?? []) {
      sizes.set(String(row.id), { size: String(row.size_label ?? ""), barcode: (row.barcode as string | null) ?? null });
    }
    return sizes;
  };

  let lines: StockDocLine[] = [];
  if (doc.status === "draft") {
    const taskLines = await db
      .from("stock_doc_lines")
      .select("variant_id, product_id, qty")
      .eq("doc_id", String(doc.id))
      .order("id");
    const rows = (taskLines.data ?? []) as { variant_id: string; product_id: string; qty: number }[];

    const sizes = await sizesFor([...new Set(rows.map((row) => String(row.variant_id)))]);
    const productIds = [...new Set(rows.map((row) => String(row.product_id)).filter(Boolean))];
    const products = new Map<string, { article: string; nmId: number | null }>();
    if (productIds.length > 0) {
      const result = await db.from("products").select("id, article, nm_id").in("id", productIds);
      for (const row of result.data ?? []) {
        products.set(String(row.id), { article: String(row.article ?? ""), nmId: row.nm_id === null ? null : Number(row.nm_id) });
      }
    }
    const warehouseName = doc.warehouse_id ? names.get(String(doc.warehouse_id)) ?? "склад удалён" : "склад не указан";
    const cabinetName = doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) ?? "кабинет" : null;
    lines = rows.map((row) => ({
      article: products.get(String(row.product_id))?.article ?? "",
      sizeLabel: sizes.get(String(row.variant_id))?.size ?? "",
      nmId: products.get(String(row.product_id))?.nmId ?? null,
      barcode: sizes.get(String(row.variant_id))?.barcode ?? null,
      qty: Number(row.qty),
      amount: 0,
      warehouseName,
      cabinetName,
      kind: "shipment",
      note: null,
    }));
  } else if (doc.movement_doc_id) {
    let movesQuery = db
      .from("stock_moves")
      .select("warehouse_id, cabinet_id, variant_id, nm_id, article, qty, amount, kind, note")
      .eq("doc_id", String(doc.movement_doc_id));
    if (doc.cabinet_id) movesQuery = movesQuery.eq("cabinet_id", String(doc.cabinet_id));
    const moves = await movesQuery.order("id");
    const sizes = await sizesFor([...new Set((moves.data ?? []).map((row) => String(row.variant_id)).filter(Boolean))]);
    lines = (moves.data ?? []).map((row) => ({
      article: String(row.article ?? ""),
      sizeLabel: sizes.get(String(row.variant_id))?.size ?? "",
      nmId: row.nm_id === null ? null : Number(row.nm_id),
      barcode: sizes.get(String(row.variant_id))?.barcode ?? null,
      qty: Number(row.qty),
      amount: Number(row.amount),
      warehouseName: names.get(String(row.warehouse_id)) ?? "склад удалён",
      cabinetName: row.cabinet_id ? cabinets.get(String(row.cabinet_id)) ?? "кабинет" : null,
      kind: String(row.kind),
      note: row.note,
    }));
  }

  const detail: StockDocDetail = {
    id: String(doc.id),
    number: String(doc.number),
    kind: doc.kind as StockDocKind,
    status: toStatus(doc.status),
    entityName: entity.name,
    entityInn: entity.inn,
    warehouseName: doc.warehouse_id ? names.get(String(doc.warehouse_id)) ?? null : null,
    cabinetName: doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) ?? "кабинет" : null,
    targetWarehouseName: doc.target_warehouse_id ? names.get(String(doc.target_warehouse_id)) ?? null : null,
    occurredAt: String(doc.occurred_at),
    note: (doc.note as string | null) ?? null,
    createdBy: (doc.created_by as string | null) ?? null,
    confirmedBy: (doc.confirmed_by as string | null) ?? null,
    confirmedAt: (doc.confirmed_at as string | null) ?? null,
    reversedByNumber: null,
    reversesNumber: null,
    lines,
    totalQty: lines.reduce((sum, row) => sum + Math.abs(row.qty), 0) / (doc.kind === "transfer" ? 2 : 1),
    totalAmount: lines.reduce((sum, row) => sum + Math.abs(row.amount), 0) / (doc.kind === "transfer" ? 2 : 1),
  };

  return <PrintableDoc doc={detail} />;
}
