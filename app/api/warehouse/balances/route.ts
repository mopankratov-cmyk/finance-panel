import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { isExternalSeller } from "@/lib/warehouse/operatorScope";
import { visibleWarehouseIds } from "@/lib/warehouse/ownership";
import { getServerSession } from "@/lib/auth/server";
import { reservationKey, reservedByVariant } from "@/lib/warehouse/tasks";
import { parseWarehouseKind, type WarehouseKind } from "@/lib/warehouse/warehouseKind";

export const dynamic = "force-dynamic";

export interface StockBalanceRow {
  warehouseId: string;
  warehouseName: string;
  warehouseKind: WarehouseKind;
  variantId: string;
  productId: string;
  nmId: number | null;
  photoUrl: string | null;
  article: string;
  name: string;
  sizeLabel: string;
  barcode: string | null;
  qty: number;
  amount: number;
  unitCost: number;
  lastMoveAt: string | null;
  /** В черновиках заданий на этом складе — «размещено, но не отгружено». */
  reserved: number;
  /** Что можно поставить в новое задание: остаток минус резерв. */
  available: number;
}

export interface StockBalancesResponse {
  rows: StockBalanceRow[];
  totals: { qty: number; amount: number; skuCount: number };
  warehouses: { id: string; name: string; kind: WarehouseKind; qty: number; amount: number }[];
  /** Когда в последний раз списывали продажи FBS. null — не списывали ни разу. */
  lastFbsSaleAt: string | null;
  /** Момент расчёта: цифра на экране живёт своей жизнью, пока её не обновят. */
  computedAt: string;
}

interface DbBalance {
  warehouse_id: string;
  variant_id: string;
  product_id: string;
  nm_id: number | null;
  photo_url: string | null;
  article: string;
  name: string;
  size_label: string;
  barcode: string | null;
  qty: number;
  amount: number;
  unit_cost: number;
  last_move_at: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

/**
 * Когда в последний раз списывали продажи FBS.
 *
 * Остаток на фулфилменте уменьшается ТОЛЬКО этим списанием: товар уезжает
 * покупателю без нашего участия, и пока продажи не списаны, панель показывает
 * склад полнее, чем он есть. Человек, сверяющий цифру с полкой, обязан видеть,
 * насколько она отстала, — иначе он поверит числу, которому неделя.
 */
async function lastFbsSaleAt(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  entityId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("stock_moves")
    .select("occurred_at")
    .eq("legal_entity_id", entityId)
    .eq("kind", "sale")
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { occurred_at?: string } | undefined;
  return row?.occurred_at ?? null;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);
  const entityId = scope.entity.id;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Четыре независимых запроса — одним кругом, а не четырьмя подряд.
  // Замер на живом стенде: экран остатков отвечал 6,1–6,8 с при ОДНОМ товаре,
  // то есть время уходило не на данные, а на последовательные обращения.
  let balances: DbBalance[];
  let warehousesResult: Awaited<ReturnType<typeof db.from>> extends never ? never : { data: { id: string; name: string; kind: string }[] | null; error: { code?: string; message: string } | null };
  let reserved: Map<string, number>;
  let lastSaleAt: string | null;
  try {
    const [warehouses, loadedBalances, loadedReserved, lastSale] = await Promise.all([
      db.from("warehouses").select("id, name, kind") as unknown as Promise<typeof warehousesResult>,
      loadAllSupabasePages<DbBalance>((from, to) =>
        db
          .from("stock_balances")
          .select("warehouse_id, variant_id, product_id, nm_id, photo_url, article, name, size_label, barcode, qty, amount, unit_cost, last_move_at")
          .eq("legal_entity_id", entityId)
          .order("article", { ascending: true })
          .range(from, to),
      ),
      // Резерв — строки черновиков заданий на этом складе. До миграции таблицы
      // строк ещё нет: тогда резерв нулевой, и вкладка работает как раньше.
      loadReserved(db, entityId),
      lastFbsSaleAt(db, entityId),
    ]);
    warehousesResult = warehouses;
    balances = loadedBalances;
    reserved = loadedReserved;
    lastSaleAt = lastSale;
  } catch (error) {
    // Подсказку про миграцию добавляем к тексту ошибки, а не вместо него: подменённое
    // сообщение уже один раз спрятало настоящую причину.
    const message = error instanceof Error ? error.message : "Не удалось прочитать остатки";
    return fail(message.includes("does not exist") ? `${message} · ${migrationHint}` : message, 500);
  }
  if (warehousesResult.error) {
    const code = warehousesResult.error.code;
    return fail(missingMigration(code) ? migrationHint : warehousesResult.error.message, missingMigration(code) ? 503 : 500);
  }

  const names = new Map<string, { name: string; kind: WarehouseKind }>();
  for (const row of warehousesResult.data ?? []) {
    names.set(String(row.id), { name: String(row.name), kind: parseWarehouseKind(row.kind) });
  }

  // Позиции, обнулённые движениями, из остатков уходят: нулевая строка — это не остаток,
  // а история, и её место в журнале движений.
  const rows: StockBalanceRow[] = balances
    .filter((row) => Number(row.qty) !== 0)
    .map((row) => {
      const warehouse = names.get(String(row.warehouse_id));
      const qty = Number(row.qty);
      const held = reserved.get(reservationKey(String(row.warehouse_id), String(row.variant_id))) ?? 0;
      return {
        warehouseId: String(row.warehouse_id),
        warehouseName: warehouse?.name ?? "склад удалён",
        warehouseKind: warehouse?.kind ?? "own",
        variantId: String(row.variant_id),
        productId: String(row.product_id),
        nmId: row.nm_id === null ? null : Number(row.nm_id),
        photoUrl: row.photo_url,
        article: String(row.article ?? ""),
        name: String(row.name ?? ""),
        sizeLabel: String(row.size_label ?? ""),
        barcode: row.barcode,
        qty,
        amount: Number(row.amount),
        unitCost: Number(row.unit_cost),
        lastMoveAt: row.last_move_at,
        reserved: held,
        available: qty - held,
      };
    })
    .sort((a, b) => b.qty - a.qty);

  // Сводка по складам засеивается всеми складами, чтобы пустой склад был виден
  // своим. Внешней компании чужие площадки знать незачем — ей остаются только
  // те, где лежит её товар.
  const session = await getServerSession();
  const allowedWarehouses = await visibleWarehouseIds(db, {
    external: isExternalSeller(session?.role),
    entityIds: [entityId],
    actor: session?.email ?? null,
  });
  const byWarehouse = new Map<string, { id: string; name: string; kind: WarehouseKind; qty: number; amount: number }>();
  for (const [id, warehouse] of names) {
    if (allowedWarehouses && !allowedWarehouses.has(id)) continue;
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
      skuCount: new Set(rows.map((row) => row.variantId)).size,
    },
    warehouses: [...byWarehouse.values()].sort((a, b) => b.qty - a.qty),
    lastFbsSaleAt: lastSaleAt,
    computedAt: new Date().toISOString(),
  };

  return NextResponse.json({ data, error: null });
}

/** Резерв черновиков по «склад:размер». Любая ошибка — пустая карта: остатки
 *  показывались до заданий и должны показываться без них. */
async function loadReserved(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, entityId: string): Promise<Map<string, number>> {
  const drafts = await db
    .from("stock_docs")
    .select("id, warehouse_id")
    .eq("legal_entity_id", entityId)
    .eq("kind", "shipment")
    .eq("status", "draft");
  if (drafts.error || !drafts.data || drafts.data.length === 0) return new Map();

  const warehouseOf = new Map(drafts.data.map((row) => [String(row.id), row.warehouse_id ? String(row.warehouse_id) : null]));
  const lines = await db
    .from("stock_doc_lines")
    .select("doc_id, variant_id, qty")
    .in("doc_id", [...warehouseOf.keys()]);
  if (lines.error) return new Map();

  return reservedByVariant((lines.data ?? []).map((line) => ({
    warehouseId: warehouseOf.get(String(line.doc_id)) ?? null,
    variantId: String(line.variant_id),
    qty: Number(line.qty),
  })));
}
