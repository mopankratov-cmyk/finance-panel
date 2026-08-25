import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import type { StockDocKind } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

export interface StockDocLine {
  article: string;
  sizeLabel: string;
  nmId: number | null;
  barcode: string | null;
  qty: number;
  amount: number;
  warehouseName: string;
  cabinetName: string | null;
  kind: string;
  note: string | null;
}

export interface StockDocDetail {
  id: string;
  number: string;
  kind: StockDocKind;
  status: "draft" | "posted" | "reversed";
  entityName: string;
  entityInn: string | null;
  warehouseName: string | null;
  targetWarehouseName: string | null;
  cabinetName: string | null;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
  reversedByNumber: string | null;
  reversesNumber: string | null;
  lines: StockDocLine[];
  totalQty: number;
  totalAmount: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Карточка документа со строками — из неё же печатается бумага для фулфилмента. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const docResult = await db
    .from("stock_docs")
    .select("id, number, kind, status, legal_entity_id, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, movement_doc_id, created_by, reversed_by, reverses")
    .eq("id", id)
    .maybeSingle();
  if (docResult.error) return fail(docResult.error.message, 500);
  const doc = docResult.data;
  if (!doc) return fail("Документ не найден", 404);

  const entity = list.rows.find((row) => row.id === String(doc.legal_entity_id));
  if (!entity) return fail("Нет доступа к юрлицу документа", 403);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinets = new Map(entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  // Строки документа — это его движения в регистре: другого источника нет и не
  // должно быть, иначе бумага и учёт разойдутся.
  let lines: StockDocLine[] = [];
  if (doc.movement_doc_id) {
    // Одна проводка может держать несколько накладных — по одной на кабинет.
    // Документ показывает только свои строки, иначе бумага на Ozon перечислит
    // и то, что уехало на Wildberries.
    let movesQuery = db
      .from("stock_moves")
      .select("warehouse_id, cabinet_id, variant_id, nm_id, article, qty, amount, kind, note")
      .eq("doc_id", String(doc.movement_doc_id));
    if (doc.cabinet_id) movesQuery = movesQuery.eq("cabinet_id", String(doc.cabinet_id));
    const movesResult = await movesQuery.order("id");
    if (movesResult.error) return fail(movesResult.error.message, 500);

    const variantIds = [...new Set((movesResult.data ?? []).map((row) => String(row.variant_id)).filter(Boolean))];
    const sizes = new Map<string, { size: string; barcode: string | null }>();
    if (variantIds.length > 0) {
      const variants = await db.from("product_variants").select("id, size_label, barcode").in("id", variantIds);
      for (const row of variants.data ?? []) {
        sizes.set(String(row.id), { size: String(row.size_label ?? ""), barcode: (row.barcode as string | null) ?? null });
      }
    }

    lines = (movesResult.data ?? []).map((row) => ({
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

  const linkedIds = [doc.reversed_by, doc.reverses].filter(Boolean).map(String);
  const linkedNumbers = new Map<string, string>();
  if (linkedIds.length > 0) {
    const linked = await db.from("stock_docs").select("id, number").in("id", linkedIds);
    for (const row of linked.data ?? []) linkedNumbers.set(String(row.id), String(row.number));
  }

  const detail: StockDocDetail = {
    id: String(doc.id),
    number: String(doc.number),
    kind: doc.kind as StockDocKind,
    status: doc.status as StockDocDetail["status"],
    entityName: entity.name,
    entityInn: entity.inn,
    warehouseName: doc.warehouse_id ? names.get(String(doc.warehouse_id)) ?? null : null,
    targetWarehouseName: doc.target_warehouse_id ? names.get(String(doc.target_warehouse_id)) ?? null : null,
    cabinetName: doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) ?? "кабинет" : null,
    occurredAt: String(doc.occurred_at),
    note: doc.note,
    createdBy: doc.created_by,
    reversedByNumber: doc.reversed_by ? linkedNumbers.get(String(doc.reversed_by)) ?? null : null,
    reversesNumber: doc.reverses ? linkedNumbers.get(String(doc.reverses)) ?? null : null,
    lines,
    // Итог считаем по модулю: в перемещении строки идут парами «минус там, плюс
    // тут», и их сумма всегда ноль — печатать ноль на накладной бессмысленно.
    totalQty: lines.reduce((sum, row) => sum + Math.abs(row.qty), 0) / (doc.kind === "transfer" ? 2 : 1),
    totalAmount: lines.reduce((sum, row) => sum + Math.abs(row.amount), 0) / (doc.kind === "transfer" ? 2 : 1),
  };
  return NextResponse.json({ data: detail, error: null });
}
