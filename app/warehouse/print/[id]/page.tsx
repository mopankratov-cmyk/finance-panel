import { notFound } from "next/navigation";
import { PrintableDoc } from "@/components/warehouse/PrintableDoc";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import type { StockDocDetail, StockDocLine } from "@/app/api/warehouse/docs/[id]/route";
import type { StockDocKind } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

/**
 * Печатная форма документа.
 *
 * Отдельная страница, а не модалка: со сторонним фулфилментом нужна бумага под
 * подпись, а печатать модалку поверх приложения — значит печатать и приложение.
 * Данные читаются на сервере тем же путём, что и карточка: строки документа —
 * это его движения в регистре, другого источника нет и не должно быть.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await listAccessibleEntities();
  const db = getSupabaseAdmin();
  if (!list.ok || !db) notFound();

  const docResult = await db
    .from("stock_docs")
    .select("id, number, kind, status, legal_entity_id, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, movement_doc_id, created_by, reversed_by, reverses")
    .eq("id", id)
    .maybeSingle();
  const doc = docResult.data;
  if (!doc) notFound();

  const entity = list.rows.find((row) => row.id === String(doc.legal_entity_id));
  if (!entity) notFound();

  const warehouses = await db.from("warehouses").select("id, name");
  const names = new Map((warehouses.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinets = new Map(entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  let lines: StockDocLine[] = [];
  if (doc.movement_doc_id) {
    let movesQuery = db
      .from("stock_moves")
      .select("warehouse_id, cabinet_id, variant_id, nm_id, article, qty, amount, kind, note")
      .eq("doc_id", String(doc.movement_doc_id));
    if (doc.cabinet_id) movesQuery = movesQuery.eq("cabinet_id", String(doc.cabinet_id));
    const moves = await movesQuery.order("id");
    const variantIds = [...new Set((moves.data ?? []).map((row) => String(row.variant_id)).filter(Boolean))];
    const sizes = new Map<string, { size: string; barcode: string | null }>();
    if (variantIds.length > 0) {
      const variants = await db.from("product_variants").select("id, size_label, barcode").in("id", variantIds);
      for (const row of variants.data ?? []) {
        sizes.set(String(row.id), { size: String(row.size_label ?? ""), barcode: (row.barcode as string | null) ?? null });
      }
    }
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
    status: doc.status as StockDocDetail["status"],
    entityName: entity.name,
    entityInn: entity.inn,
    warehouseName: doc.warehouse_id ? names.get(String(doc.warehouse_id)) ?? null : null,
    cabinetName: doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) ?? "кабинет" : null,
    targetWarehouseName: doc.target_warehouse_id ? names.get(String(doc.target_warehouse_id)) ?? null : null,
    occurredAt: String(doc.occurred_at),
    note: doc.note,
    createdBy: doc.created_by,
    reversedByNumber: null,
    reversesNumber: null,
    lines,
    totalQty: lines.reduce((sum, row) => sum + Math.abs(row.qty), 0) / (doc.kind === "transfer" ? 2 : 1),
    totalAmount: lines.reduce((sum, row) => sum + Math.abs(row.amount), 0) / (doc.kind === "transfer" ? 2 : 1),
  };

  return <PrintableDoc doc={detail} />;
}
