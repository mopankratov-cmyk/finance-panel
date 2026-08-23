import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

export interface StockBalanceRow {
  warehouseId: string;
  warehouseName: string;
  warehouseKind: "own" | "fulfillment";
  productId: string;
  nmId: number | null;
  article: string;
  name: string;
  qty: number;
  amount: number;
  unitCost: number;
  lastMoveAt: string | null;
}

export interface StockBalancesResponse {
  rows: StockBalanceRow[];
  totals: { qty: number; amount: number; skuCount: number };
  warehouses: { id: string; name: string; kind: "own" | "fulfillment"; qty: number; amount: number }[];
}

interface DbBalance {
  warehouse_id: string;
  product_id: string;
  nm_id: number | null;
  article: string;
  name: string;
  qty: number;
  amount: number;
  unit_cost: number;
  last_move_at: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);
  const entityId = scope.entity.id;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehousesResult = await db
    .from("warehouses")
    .select("id, name, kind");
  if (warehousesResult.error) {
    const code = warehousesResult.error.code;
    return fail(missingMigration(code) ? migrationHint : warehousesResult.error.message, missingMigration(code) ? 503 : 500);
  }

  const names = new Map<string, { name: string; kind: "own" | "fulfillment" }>();
  for (const row of warehousesResult.data ?? []) {
    names.set(String(row.id), { name: String(row.name), kind: row.kind === "fulfillment" ? "fulfillment" : "own" });
  }

  let balances: DbBalance[];
  try {
    balances = await loadAllSupabasePages<DbBalance>((from, to) =>
      db
        .from("stock_balances")
        .select("warehouse_id, product_id, nm_id, article, name, qty, amount, unit_cost, last_move_at")
        .eq("legal_entity_id", entityId)
        .order("article", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    // Подсказку про миграцию добавляем к тексту ошибки, а не вместо него: подменённое
    // сообщение уже один раз спрятало настоящую причину.
    const message = error instanceof Error ? error.message : "Не удалось прочитать остатки";
    return fail(message.includes("does not exist") ? `${message} · ${migrationHint}` : message, 500);
  }

  // Позиции, обнулённые движениями, из остатков уходят: нулевая строка — это не остаток,
  // а история, и её место в журнале движений.
  const rows: StockBalanceRow[] = balances
    .filter((row) => Number(row.qty) !== 0)
    .map((row) => {
      const warehouse = names.get(String(row.warehouse_id));
      return {
        warehouseId: String(row.warehouse_id),
        warehouseName: warehouse?.name ?? "склад удалён",
        warehouseKind: warehouse?.kind ?? "own",
        productId: String(row.product_id),
        nmId: row.nm_id === null ? null : Number(row.nm_id),
        article: String(row.article ?? ""),
        name: String(row.name ?? ""),
        qty: Number(row.qty),
        amount: Number(row.amount),
        unitCost: Number(row.unit_cost),
        lastMoveAt: row.last_move_at,
      };
    })
    .sort((a, b) => b.qty - a.qty);

  const byWarehouse = new Map<string, { id: string; name: string; kind: "own" | "fulfillment"; qty: number; amount: number }>();
  for (const [id, warehouse] of names) {
    byWarehouse.set(id, { id, name: warehouse.name, kind: warehouse.kind, qty: 0, amount: 0 });
  }
  for (const row of rows) {
    const bucket = byWarehouse.get(row.warehouseId)
      ?? { id: row.warehouseId, name: row.warehouseName, kind: row.warehouseKind, qty: 0, amount: 0 };
    bucket.qty += row.qty;
    bucket.amount += row.amount;
    byWarehouse.set(row.warehouseId, bucket);
  }

  const data: StockBalancesResponse = {
    rows,
    totals: {
      qty: rows.reduce((sum, row) => sum + row.qty, 0),
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      skuCount: new Set(rows.map((row) => row.productId)).size,
    },
    warehouses: [...byWarehouse.values()].sort((a, b) => b.qty - a.qty),
  };

  return NextResponse.json({ data, error: null });
}
