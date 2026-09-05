import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export interface StockMoveRow {
  id: number;
  warehouseId: string;
  warehouseName: string;
  nmId: number;
  article: string;
  qty: number;
  amount: number;
  // 'sale' — списание продажи FBS: его пишет post_fbs_sales (миграция
  // 202608240020). Пока вида не было в типе, такие строки приезжали на экран
  // без подписи — пустая клетка вместо «продажа FBS».
  kind: "receipt" | "shipment" | "writeoff" | "return" | "adjustment" | "transfer" | "sale";
  docType: string;
  docId: string | null;
  /** Человеческий номер документа (ОТГ-2026-0012). null — движение записано
   *  не документом склада, а внешним источником вроде продаж FBS. */
  docNumber: string | null;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
}

interface DbMove {
  id: number;
  warehouse_id: string;
  nm_id: number;
  article: string;
  qty: number;
  amount: number;
  kind: StockMoveRow["kind"];
  doc_type: string;
  doc_id: string | null;
  occurred_at: string;
  note: string | null;
  created_by: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const url = new URL(request.url);
  const scope = await resolveEntity(url.searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);
  const entityId = scope.entity.id;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehousesResult = await db.from("warehouses").select("id, name");
  if (warehousesResult.error) {
    const code = warehousesResult.error.code;
    return fail(missingMigration(code) ? migrationHint : warehousesResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  // Журнал читается последней страницей, а не целиком: движений со временем станут
  // десятки тысяч, а на экране нужны последние.
  let query = db
    .from("stock_moves")
    .select("id, warehouse_id, nm_id, article, qty, amount, kind, doc_type, doc_id, occurred_at, note, created_by")
    .eq("legal_entity_id", entityId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  const nmId = Number(url.searchParams.get("nmId"));
  if (Number.isFinite(nmId) && nmId > 0) query = query.eq("nm_id", nmId);
  const warehouseId = url.searchParams.get("warehouse");
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const { data, error } = await query;
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  // Номера документов для страницы. Без них в журнале стоял технический код
  // вроде `purchase_receipt` — человек ищет документ по номеру, а не по типу.
  // Часть движений (продажи FBS) документом склада не оформлена: у них номера
  // нет и не будет, и это честная пустота.
  const docIds = [...new Set(((data ?? []) as DbMove[]).map((row) => row.doc_id).filter(Boolean).map(String))];
  const docNumbers = new Map<string, string>();
  if (docIds.length > 0) {
    const numbered = await db.from("stock_docs").select("id, number").in("id", docIds);
    for (const row of numbered.data ?? []) docNumbers.set(String(row.id), String(row.number));
  }

  const rows: StockMoveRow[] = ((data ?? []) as DbMove[]).map((row) => ({
    id: Number(row.id),
    warehouseId: String(row.warehouse_id),
    warehouseName: names.get(String(row.warehouse_id)) ?? "склад удалён",
    nmId: Number(row.nm_id),
    article: String(row.article ?? ""),
    qty: Number(row.qty),
    amount: Number(row.amount),
    kind: row.kind,
    docType: String(row.doc_type),
    docId: row.doc_id,
    docNumber: row.doc_id ? docNumbers.get(String(row.doc_id)) ?? null : null,
    occurredAt: row.occurred_at,
    note: row.note,
    createdBy: row.created_by,
  }));

  return NextResponse.json({ data: { rows, truncated: rows.length === PAGE_SIZE }, error: null });
}
