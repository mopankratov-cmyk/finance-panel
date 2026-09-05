import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { isMissingColumn } from "@/lib/warehouse/productRow";
import type { StockDocKind } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export interface StockDocRow {
  id: string;
  number: string;
  kind: StockDocKind;
  /** draft — задание ждёт фулфилмента; cancelled — задание отменено до отгрузки. */
  status: "draft" | "posted" | "reversed" | "cancelled";
  warehouseName: string | null;
  targetWarehouseName: string | null;
  /** Кабинет-адресат отгрузки. У перемещения и списания его нет. */
  cabinetName: string | null;
  occurredAt: string;
  note: string | null;
  qty: number;
  amount: number;
  lines: number;
  createdBy: string | null;
  /** Кто и когда подтвердил отгрузку по заданию; у прямых проводок пусто. */
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Номер документа, которым это сторнировано, либо который сторнирует этот. */
  reversedByNumber: string | null;
  reversesNumber: string | null;
  /** Партия приёмки: у неё своя печатная форма и свои строки. */
  batchId?: string | null;
}

export interface StockDocsResponse {
  rows: StockDocRow[];
  truncated: boolean;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608240021 и 202608240022";

const COLUMNS_LEGACY = "id, number, kind, status, warehouse_id, target_warehouse_id, cabinet_id, occurred_at, note, result, created_by, reversed_by, reverses";
// Колонки миграции 202609040002 — до неё их нет, и журнал читается без них.
const COLUMNS = `${COLUMNS_LEGACY}, confirmed_at, confirmed_by`;

const num = (result: unknown, key: string): number => {
  const value = (result as Record<string, unknown> | null)?.[key];
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
};

const toStatus = (value: unknown): StockDocRow["status"] =>
  value === "draft" || value === "reversed" || value === "cancelled" ? value : "posted";

/** Журнал документов: что именно проводили, под каким номером и кто. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const query = (columns: string) => db
    .from("stock_docs")
    .select(columns)
    .eq("legal_entity_id", scope.entity.id)
    .order("occurred_at", { ascending: false })
    .order("number", { ascending: false })
    .limit(PAGE_SIZE);
  let result = await query(COLUMNS);
  if (result.error && isMissingColumn(result.error.code)) result = await query(COLUMNS_LEGACY);
  const { data, error } = result;
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  const docs = (data ?? []) as unknown as Record<string, unknown>[];

  // Приёмки живут в отдельной таблице (stock_receipt_batches), а номер берут из
  // ОБЩЕЙ нумерации документов и объявляются документом в «Событиях». В журнал
  // они при этом не попадали: человек видел ПРМ-2026-0004 на экране приёмки и
  // в ленте — и не находил его там, где документы обещаны все.
  const [warehousesResult, receiptsResult] = await Promise.all([
    db.from("warehouses").select("id, name"),
    db
      .from("stock_receipt_batches")
      .select("batch_id, number, supplier, counted_at, counted_by, created_by, created_at")
      .eq("legal_entity_id", scope.entity.id)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
  ]);
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinets = new Map(scope.entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  // Номера связанных документов: в журнале ссылка должна читаться как номер,
  // а не как идентификатор.
  const linkedIds = [...new Set(docs.flatMap((row) => [row.reversed_by, row.reverses]).filter(Boolean).map(String))];
  const linkedNumbers = new Map<string, string>();
  if (linkedIds.length > 0) {
    const linked = await db.from("stock_docs").select("id, number").in("id", linkedIds);
    for (const row of linked.data ?? []) linkedNumbers.set(String(row.id), String(row.number));
  }

  // У черновика итога проводки нет — его количество живёт в строках задания.
  // Таблицы строк может ещё не быть: тогда у черновика ноль, как и раньше.
  // Отменённое задание движений не имеет, но состав у него есть — в плане.
  // Без этого в журнале «0 шт, — позиций», и непонятно, что отменили.
  const draftIds = docs.filter((row) => row.status === "draft" || row.status === "cancelled").map((row) => String(row.id));
  const draftTotals = new Map<string, { qty: number; lines: number }>();
  if (draftIds.length > 0) {
    const lines = await db.from("stock_doc_lines").select("doc_id, qty").in("doc_id", draftIds);
    for (const line of lines.error ? [] : lines.data ?? []) {
      const bucket = draftTotals.get(String(line.doc_id)) ?? { qty: 0, lines: 0 };
      bucket.qty += Number(line.qty) || 0;
      bucket.lines += 1;
      draftTotals.set(String(line.doc_id), bucket);
    }
  }

  const rows: StockDocRow[] = docs.map((row) => {
    const draft = draftTotals.get(String(row.id));
    return {
      id: String(row.id),
      number: String(row.number),
      kind: row.kind as StockDocKind,
      status: toStatus(row.status),
      warehouseName: row.warehouse_id ? names.get(String(row.warehouse_id)) ?? "склад удалён" : null,
      targetWarehouseName: row.target_warehouse_id ? names.get(String(row.target_warehouse_id)) ?? "склад удалён" : null,
      cabinetName: row.cabinet_id ? cabinets.get(String(row.cabinet_id)) ?? "кабинет" : null,
      occurredAt: String(row.occurred_at),
      note: (row.note as string | null) ?? null,
      // У коррекции прихода нет «количества документа» — есть дельты, и
      // именно они отвечают на вопрос «на сколько поправили».
      qty: draft ? draft.qty : num(row.result, "qty") || num(row.result, "deltaQty"),
      amount: Math.abs(num(row.result, "amount") || num(row.result, "deltaAmount")),
      lines: draft ? draft.lines : num(row.result, "lines") || num(row.result, "posted"),
      createdBy: (row.created_by as string | null) ?? null,
      confirmedBy: (row.confirmed_by as string | null) ?? null,
      confirmedAt: (row.confirmed_at as string | null) ?? null,
      reversedByNumber: row.reversed_by ? linkedNumbers.get(String(row.reversed_by)) ?? null : null,
      reversesNumber: row.reverses ? linkedNumbers.get(String(row.reverses)) ?? null : null,
    };
  });

  // Партии приёмки в тот же журнал. Количества у них считаются по строкам
  // приёмки — за ними лезть отдельным запросом дорого и незачем: в журнале
  // важно НАЙТИ документ и открыть его печатную форму, а состав виден на
  // вкладке «Приёмка» и в самой печати.
  const receiptRows: StockDocRow[] = (receiptsResult.error ? [] : receiptsResult.data ?? []).map((row) => ({
    id: String(row.batch_id),
    batchId: String(row.batch_id),
    number: String(row.number ?? "без номера"),
    kind: "receipt" as StockDocKind,
    status: row.counted_at ? ("posted" as const) : ("draft" as const),
    warehouseName: null,
    targetWarehouseName: null,
    cabinetName: (row.supplier as string | null) ?? null,
    occurredAt: String(row.counted_at ?? row.created_at),
    note: row.supplier ? `Поставщик: ${row.supplier}` : null,
    qty: 0,
    amount: 0,
    lines: 0,
    createdBy: (row.counted_by as string | null) ?? (row.created_by as string | null) ?? null,
    confirmedBy: (row.counted_by as string | null) ?? null,
    confirmedAt: (row.counted_at as string | null) ?? null,
    reversedByNumber: null,
    reversesNumber: null,
  }));

  const merged = [...rows, ...receiptRows]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.number.localeCompare(a.number))
    .slice(0, PAGE_SIZE);

  const payload: StockDocsResponse = { rows: merged, truncated: rows.length === PAGE_SIZE || merged.length === PAGE_SIZE };
  return NextResponse.json({ data: payload, error: null });
}
