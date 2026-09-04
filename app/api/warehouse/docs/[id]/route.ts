import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { isMissingColumn } from "@/lib/warehouse/productRow";
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
  /** draft — задание ждёт фулфилмента; cancelled — задание отменено до отгрузки. */
  status: "draft" | "posted" | "reversed" | "cancelled";
  entityName: string;
  entityInn: string | null;
  warehouseName: string | null;
  targetWarehouseName: string | null;
  cabinetName: string | null;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
  /** Кто и когда подтвердил отгрузку по заданию; у прямых проводок пусто. */
  confirmedBy: string | null;
  confirmedAt: string | null;
  reversedByNumber: string | null;
  reversesNumber: string | null;
  lines: StockDocLine[];
  totalQty: number;
  totalAmount: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

const COLUMNS_LEGACY = "id, number, kind, status, legal_entity_id, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, movement_doc_id, created_by, reversed_by, reverses";
// Колонки миграции 202609040002 — до неё их нет, и карточка читается без них.
const COLUMNS = `${COLUMNS_LEGACY}, confirmed_at, confirmed_by`;

const toStatus = (value: unknown): StockDocDetail["status"] =>
  value === "draft" || value === "reversed" || value === "cancelled" ? value : "posted";

/** Карточка документа со строками — из неё же печатается бумага для фулфилмента. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const query = (columns: string) => db.from("stock_docs").select(columns).eq("id", id).maybeSingle();
  let docResult = await query(COLUMNS);
  if (docResult.error && isMissingColumn(docResult.error.code)) docResult = await query(COLUMNS_LEGACY);
  if (docResult.error) return fail(docResult.error.message, 500);
  const doc = docResult.data as unknown as Record<string, unknown> | null;
  if (!doc) return fail("Документ не найден", 404);

  const entity = list.rows.find((row) => row.id === String(doc.legal_entity_id));
  if (!entity) return fail("Нет доступа к юрлицу документа", 403);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
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

  // Строки документа — это его движения в регистре: другого источника нет и не
  // должно быть, иначе бумага и учёт разойдутся.
  let lines: StockDocLine[] = [];
  if (doc.status === "draft" || doc.status === "cancelled") {
    // Черновик — задание: движений ещё нет, строки живут в stock_doc_lines. Это
    // единственное исключение: бумага для фулфилмента нужна ДО того, как товар
    // уехал. Себестоимости у строки нет — задание её не знает.
    const taskLines = await db
      .from("stock_doc_lines")
      .select("variant_id, product_id, qty")
      .eq("doc_id", String(doc.id))
      .order("id");
    if (taskLines.error && !["42P01", "PGRST205"].includes(taskLines.error.code ?? "")) return fail(taskLines.error.message, 500);
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

    const sizes = await sizesFor([...new Set((movesResult.data ?? []).map((row) => String(row.variant_id)).filter(Boolean))]);
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
    status: toStatus(doc.status),
    entityName: entity.name,
    entityInn: entity.inn,
    warehouseName: doc.warehouse_id ? names.get(String(doc.warehouse_id)) ?? null : null,
    targetWarehouseName: doc.target_warehouse_id ? names.get(String(doc.target_warehouse_id)) ?? null : null,
    cabinetName: doc.cabinet_id ? cabinets.get(String(doc.cabinet_id)) ?? "кабинет" : null,
    occurredAt: String(doc.occurred_at),
    note: (doc.note as string | null) ?? null,
    createdBy: (doc.created_by as string | null) ?? null,
    confirmedBy: (doc.confirmed_by as string | null) ?? null,
    confirmedAt: (doc.confirmed_at as string | null) ?? null,
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
