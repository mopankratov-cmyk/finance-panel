import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { isExternalSeller } from "@/lib/warehouse/operatorScope";
import { visibleWarehouseIds } from "@/lib/warehouse/ownership";
import { getServerSession } from "@/lib/auth/server";
import {
  compareSizeLabels,
  type StockMatrixResponse,
  type StockReceiptCell,
  type StockShipmentCell,
  type StockVariantRow,
} from "@/lib/warehouse/stockMatrix";
import { parseWarehouseKind } from "@/lib/warehouse/warehouseKind";

export const dynamic = "force-dynamic";

interface DbBalance {
  warehouse_id: string;
  variant_id: string;
  product_id: string;
  qty: number;
  amount: number;
}

interface DbShipmentDoc {
  id: string;
  number: string;
  status: string;
  cabinet_id: string | null;
  warehouse_id: string | null;
  occurred_at: string;
  movement_doc_id: string | null;
}

interface DbDocLine {
  doc_id: string;
  variant_id: string;
  product_id: string;
  qty: number;
}

interface DbMove {
  variant_id: string;
  product_id: string | null;
  qty: number;
  kind: string;
  doc_id: string | null;
  cabinet_id: string | null;
}

interface DbReceipt {
  batch_id: string;
  product_id: string | null;
  variant_id: string | null;
  status: string;
  expected_qty: number | null;
  received_qty: number | null;
  defect_qty: number | null;
  posted_at: string | null;
  expected_at: string | null;
  created_at: string;
}

interface DbVariant {
  id: string;
  product_id: string;
  size_label: string | null;
  barcode: string | null;
}

interface DbProduct {
  id: string;
  article: string | null;
  name: string | null;
  nm_id: number | null;
  photo_url: string | null;
  model: string | null;
  color: string | null;
  imt_id: number | null;
  is_novelty: boolean | null;
}

interface DbError {
  message: string;
  code?: string;
}

/** Всё, что склад знает о размере, — накапливается по источникам, потом становится строкой. */
interface Accumulator {
  variantId: string;
  byWarehouse: Map<string, number>;
  amount: number;
  reserved: number;
  expected: number;
  received: number;
  shipped: number;
  receipts: Map<string, StockReceiptCell>;
  shipments: Map<string, StockShipmentCell>;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/**
 * Когда в последний раз списывали продажи FBS.
 *
 * Остаток на фулфилменте уменьшается ТОЛЬКО этим списанием: товар уезжает
 * покупателю без нашего участия. Пока продажи не списаны, панель показывает
 * склад полнее, чем он есть, и человек, сверяющий цифру с полкой, обязан
 * видеть, насколько она отстала.
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
  return ((data ?? [])[0] as { occurred_at?: string } | undefined)?.occurred_at ?? null;
}
const isMissingMigration = (code?: string | null) =>
  ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const MIGRATION_HINT = "Примените миграции 202609040002_warehouse_flow.sql и 202609040003_warehouse_flow_functions.sql";
const dbFail = (error: DbError) =>
  fail(isMissingMigration(error.code) ? MIGRATION_HINT : error.message, isMissingMigration(error.code) ? 503 : 500);

const round2 = (value: number) => Math.round(value * 100) / 100;
const byDate = (a: { date: string | null }, b: { date: string | null }) => String(a.date ?? "").localeCompare(String(b.date ?? ""));
const RECEIPT_RANK: Record<StockReceiptCell["state"], number> = { expected: 0, received: 1, posted: 2 };

/** `.in()` по сотням идентификаторов не влезает в URL, а ответ без range
 *  PostgREST молча режет на тысяче строк — поэтому кусками. */
async function chunked<Row>(
  ids: string[],
  load: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: DbError | null }>,
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

/**
 * Склад по ТЗ команды: строка на каждый размер юрлица с остатком по складам,
 * резервом заданий, ожидаемым приходом и историей — какие партии его приносили
 * и какие документы увозили. Иерархию «модель → цвет → размер» из этого
 * собирает клиент (buildStockMatrix).
 *
 * Продажи FBS (kind='sale') сюда намеренно не входят — решение владельца
 * 04.09.2026: в «получено» и «отгружено» только приёмки и отгрузки.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  // Где именно уходит время. Замер снаружи показал 3–7 с на пустом складе, а
  // распараллеливание запросов сняло только треть — значит под ними лежит
  // что-то ещё. Гадать бесполезно: `?timings=1` отвечает по этапам, как это
  // уже сделано в /api/shelf/table.
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => { timings[name] = Date.now() - startedAt; };
  mark("gate");

  const url = new URL(request.url);
  const scope = await resolveEntity(url.searchParams.get("entity"));
  mark("resolveEntity");
  if (!scope.ok) return fail(scope.error, scope.status);
  const entityId = scope.entity.id;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Приёмка живёт в кабинете, склад — по юрлицу: партии собираем по собственным
  // кабинетам, как это делает вкладка приёмок. Агентские — чужой товар.
  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  const cabinetNames = new Map(scope.entity.cabinets.map((link) => [link.cabinetId, link.cabinetName]));

  // Отставание остатка от факта. Запускаем ДО основной пачки и ждём после неё:
  // запрос независимый, и своего круга он не стоит.
  const lastSalePromise = lastFbsSaleAt(db, scope.entity.id);

  // Старые таблицы читаем постранично: у юрлица с историей движений больше
  // тысячи, и одна страница молча отдала бы часть. Независимое — параллельно.
  const loaded = await Promise.all([
    db.from("warehouses").select("id, name, kind, is_active"),
    loadAllSupabasePages<DbBalance>(
      (from, to) => db
        .from("stock_balances")
        .select("warehouse_id, variant_id, product_id, qty, amount")
        .eq("legal_entity_id", entityId)
        .order("variant_id")
        .order("warehouse_id")
        .range(from, to),
      { label: "Остатки" },
    ),
    loadAllSupabasePages<DbShipmentDoc>(
      (from, to) => db
        .from("stock_docs")
        .select("id, number, status, cabinet_id, warehouse_id, occurred_at, movement_doc_id")
        .eq("legal_entity_id", entityId)
        .eq("kind", "shipment")
        .neq("status", "cancelled")
        // Сторно — не отгрузка, а её отмена; отменённый документ покажется сам, статусом reversed.
        .is("reverses", null)
        .order("occurred_at")
        .order("id")
        .range(from, to),
      { label: "Отгрузки" },
    ),
    loadAllSupabasePages<DbMove>(
      (from, to) => db
        .from("stock_moves")
        .select("variant_id, product_id, qty, kind, doc_id, cabinet_id")
        .eq("legal_entity_id", entityId)
        .eq("kind", "shipment")
        .order("id")
        .range(from, to),
      { label: "Движения", maxPages: 60, concurrency: 3 },
    ),
    ownCabinets.length === 0
      ? Promise.resolve([] as DbReceipt[])
      : loadAllSupabasePages<DbReceipt>(
        (from, to) => db
          .from("purchase_receipts")
          .select("batch_id, product_id, variant_id, status, expected_qty, received_qty, defect_qty, posted_at, expected_at, created_at")
          .in("cabinet_id", ownCabinets)
          .order("id")
          .range(from, to),
        { label: "Приёмки" },
      ),
  ]).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (!loaded.ok) {
    return fail(loaded.error instanceof Error ? loaded.error.message : "Не удалось прочитать склад", 500);
  }
  mark("queries");
  const [warehousesResult, balances, docs, moves, receipts] = loaded.value;
  if (warehousesResult.error) return dbFail(warehousesResult.error);

  const warehouses = (warehousesResult.data ?? []) as { id: string; name: string; kind: string | null; is_active: boolean | null }[];

  // Черновики заданий: их строки — резерв и колонка «размещено, не отгружено».
  const draftIds = docs.filter((doc) => doc.status === "draft").map((doc) => String(doc.id));

  /**
   * Вторая волна — ОДНИМ кругом.
   *
   * Эти четыре запроса зависят от первой пачки, но не друг от друга. Пока они
   * шли подряд, замер `?timings=1` показывал 1,0–2,3 с между «запросы» и
   * «сборка» — почти всё время экрана уходило туда, а не на данные. Круг до
   * Supabase из fra1 стоит около полусекунды: пять последовательных — это
   * две с половиной секунды ожидания на ровном месте.
   *
   * Список складов для колонок и разбивки: своим он общий, внешней компании —
   * только её собственные, иначе чужие названия видны на первом же экране.
   */
  const session = await getServerSession();
  const [allowedWarehouses, draftLines, batches, defaults] = await Promise.all([
    visibleWarehouseIds(db, {
      external: isExternalSeller(session?.role),
      entityIds: [entityId],
      actor: session?.email ?? null,
    }),
    // До миграции таблиц заданий и шапок нет. Это не повод прятать остаток:
    // вкладка обязана открываться на старой базе, просто без резерва и номеров.
    chunked<DbDocLine>(
      draftIds,
      (chunk) => db.from("stock_doc_lines").select("doc_id, variant_id, product_id, qty").in("doc_id", chunk),
      100,
    ),
    // Номера партий — из шапок; у партии без шапки номера нет, и это нормально.
    chunked<{ batch_id: string; number: string | null }>(
      receipts.map((row) => String(row.batch_id)),
      (chunk) => db.from("stock_receipt_batches").select("batch_id, number").in("batch_id", chunk),
    ),
    // Строка приёмки без размера относится к базовому варианту товара — так же,
    // как её проводит post_receipt_batch.
    chunked<{ id: string; product_id: string }>(
      receipts.filter((row) => !row.variant_id && row.product_id).map((row) => String(row.product_id)),
      (chunk) => db.from("product_variants").select("id, product_id").in("product_id", chunk).eq("is_default", true),
    ),
  ]);
  mark("wave2");
  if (draftLines.error && !isMissingMigration(draftLines.error.code)) return dbFail(draftLines.error);
  if (batches.error && !isMissingMigration(batches.error.code)) return dbFail(batches.error);
  if (defaults.error) return dbFail(defaults.error);
  const batchNumbers = new Map(batches.rows.map((row) => [String(row.batch_id), row.number ? String(row.number) : null]));
  const defaultVariant = new Map(defaults.rows.map((row) => [String(row.product_id), String(row.id)]));

  const activeWarehouses = warehouses
    .filter((row) => row.is_active !== false)
    .filter((row) => !allowedWarehouses || allowedWarehouses.has(String(row.id)))
    .map((row) => ({ id: String(row.id), name: String(row.name), kind: parseWarehouseKind(row.kind) }));


  const acc = new Map<string, Accumulator>();
  const at = (variantId: string): Accumulator => {
    let item = acc.get(variantId);
    if (!item) {
      item = {
        variantId,
        byWarehouse: new Map(),
        amount: 0,
        reserved: 0,
        expected: 0,
        received: 0,
        shipped: 0,
        receipts: new Map(),
        shipments: new Map(),
      };
      acc.set(variantId, item);
    }
    return item;
  };
  const addShipment = (item: Accumulator, doc: DbShipmentDoc, qty: number, status: StockShipmentCell["status"]) => {
    const key = String(doc.id);
    const cell = item.shipments.get(key);
    if (cell) {
      cell.qty += qty;
      return;
    }
    item.shipments.set(key, {
      docId: key,
      number: String(doc.number),
      date: String(doc.occurred_at),
      qty,
      cabinetName: doc.cabinet_id ? cabinetNames.get(String(doc.cabinet_id)) ?? "кабинет" : null,
      status,
    });
  };

  // Позиции, обнулённые движениями, из остатка уходят — они история, а не остаток.
  for (const row of balances) {
    const qty = Number(row.qty);
    if (qty === 0) continue;
    const item = at(String(row.variant_id));
    const warehouseId = String(row.warehouse_id);
    item.byWarehouse.set(warehouseId, (item.byWarehouse.get(warehouseId) ?? 0) + qty);
    item.amount += Number(row.amount);
  }

  const docById = new Map(docs.map((doc) => [String(doc.id), doc]));
  for (const line of draftLines.rows) {
    const doc = docById.get(String(line.doc_id));
    if (!doc) continue;
    const qty = Math.max(0, Number(line.qty) || 0);
    const item = at(String(line.variant_id));
    item.reserved += qty;
    addShipment(item, doc, qty, "draft");
  }

  // «Отгружено» считаем по движениям здесь, а не в SQL: view остатков их не
  // хранит. Сторно отгрузки пишет положительное движение того же вида — оно
  // вычитается, и итог сходится с колонками матрицы без сторнированных.
  const shipmentMoves = new Map<string, DbMove[]>();
  for (const move of moves) {
    if (move.kind !== "shipment") continue;
    const qty = Number(move.qty);
    const item = at(String(move.variant_id));
    item.shipped -= qty;
    if (move.doc_id) {
      const list = shipmentMoves.get(String(move.doc_id)) ?? [];
      list.push(move);
      shipmentMoves.set(String(move.doc_id), list);
    }
  }

  // Проведённые и сторнированные отгрузки: количество — из движений документа
  // в границах его кабинета (одна проводка может держать несколько накладных).
  for (const doc of docs) {
    if (doc.status === "draft" || !doc.movement_doc_id) continue;
    const status: StockShipmentCell["status"] = doc.status === "reversed" ? "reversed" : "posted";
    for (const move of shipmentMoves.get(String(doc.movement_doc_id)) ?? []) {
      if (doc.cabinet_id && String(move.cabinet_id ?? "") !== String(doc.cabinet_id)) continue;
      addShipment(at(String(move.variant_id)), doc, Math.abs(Number(move.qty)), status);
    }
  }

  // Приёмки: ожидаемое — то, что ещё не на остатке; колонка партии — по любому состоянию.
  for (const row of receipts) {
    const variantId = row.variant_id
      ? String(row.variant_id)
      : row.product_id ? defaultVariant.get(String(row.product_id)) : undefined;
    if (!variantId) continue;
    const item = at(variantId);
    const state: StockReceiptCell["state"] = row.status === "expected" ? "expected" : row.posted_at ? "posted" : "received";
    const qty = state === "expected"
      ? Number(row.expected_qty ?? 0)
      : Number(row.received_qty ?? 0) - Number(row.defect_qty ?? 0);
    // «Получено» — то же число, что в ячейках партий: принято минус брак по
    // строкам, вставшим на остаток. Коррекция прихода правит эти же строки,
    // поэтому итог после неё сходится с регистром без чтения движений.
    if (state === "posted") item.received += qty;
    else item.expected += qty;

    const key = String(row.batch_id);
    const cell = item.receipts.get(key);
    if (cell) {
      cell.qty += qty;
      // Состояние ячейки — по самой отстающей строке партии, как на вкладке приёмок.
      if (RECEIPT_RANK[state] < RECEIPT_RANK[cell.state]) cell.state = state;
      continue;
    }
    item.receipts.set(key, {
      batchId: key,
      number: batchNumbers.get(key) ?? null,
      date: row.posted_at ?? row.expected_at ?? row.created_at ?? null,
      qty,
      state,
    });
  }

  // Справочник: размеры — по идентификаторам из всех источников, а не по товару.
  // У модели с десятком размеров выборка по товарам упёрлась бы в тысячу строк.
  const variantsResult = await chunked<DbVariant>(
    [...acc.keys()],
    (chunk) => db.from("product_variants").select("id, product_id, size_label, barcode").in("id", chunk),
  );
  if (variantsResult.error) return dbFail(variantsResult.error);
  const variants = new Map(variantsResult.rows.map((row) => [String(row.id), row]));

  const productIds = variantsResult.rows.map((row) => String(row.product_id));
  let productsResult = await chunked<DbProduct>(
    productIds,
    (chunk) => db
      .from("products")
      .select("id, article, name, nm_id, photo_url, model, color, imt_id, is_novelty")
      .in("id", chunk),
  );
  // Колонок модели и цвета на старой базе нет — иерархия тогда строится по
  // артикулу, а не падает целиком.
  if (productsResult.error && isMissingMigration(productsResult.error.code)) {
    productsResult = await chunked<DbProduct>(
      productIds,
      (chunk) => db
        .from("products")
        .select("id, article, name, nm_id, photo_url")
        .in("id", chunk)
        .then((result) => ({ data: (result.data ?? null) as DbProduct[] | null, error: result.error })),
    );
  }
  if (productsResult.error) return dbFail(productsResult.error);
  const products = new Map(productsResult.rows.map((row) => [String(row.id), row]));

  const rows: StockVariantRow[] = [];
  for (const item of acc.values()) {
    const variant = variants.get(item.variantId);
    const product = variant ? products.get(String(variant.product_id)) : undefined;
    if (!variant || !product) continue;

    const qty = [...item.byWarehouse.values()].reduce((sum, value) => sum + value, 0);
    const hasHistory = item.receipts.size > 0 || item.shipments.size > 0 || item.received > 0 || item.shipped > 0;
    if (qty === 0 && item.reserved === 0 && item.expected === 0 && !hasHistory) continue;

    rows.push({
      variantId: item.variantId,
      productId: String(product.id),
      article: String(product.article ?? ""),
      name: String(product.name ?? ""),
      sizeLabel: String(variant.size_label ?? ""),
      barcode: variant.barcode ?? null,
      nmId: product.nm_id === null || product.nm_id === undefined ? null : Number(product.nm_id),
      photoUrl: product.photo_url ?? null,
      imtId: product.imt_id === null || product.imt_id === undefined ? null : Number(product.imt_id),
      model: product.model ?? null,
      color: product.color ?? null,
      isNovelty: Boolean(product.is_novelty),
      qty,
      amount: round2(item.amount),
      unitCost: qty > 0 ? round2(item.amount / qty) : 0,
      byWarehouse: [...item.byWarehouse.entries()].map(([warehouseId, value]) => ({ warehouseId, qty: value })),
      reserved: item.reserved,
      expected: item.expected,
      received: item.received,
      shipped: item.shipped,
      receipts: [...item.receipts.values()].sort(byDate),
      shipments: [...item.shipments.values()].sort(byDate),
    });
  }
  rows.sort((a, b) => a.article.localeCompare(b.article, "ru") || compareSizeLabels(a.sizeLabel, b.sizeLabel));

  mark("assemble");
  const data: StockMatrixResponse = {
    rows,
    warehouses: activeWarehouses,
    lastFbsSaleAt: await lastSalePromise,
    computedAt: new Date().toISOString(),
    totals: {
      qty: rows.reduce((sum, row) => sum + row.qty, 0),
      amount: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
      reserved: rows.reduce((sum, row) => sum + row.reserved, 0),
      expected: rows.reduce((sum, row) => sum + row.expected, 0),
      skuCount: rows.filter((row) => row.qty > 0).length,
    },
  };
  mark("total");
  return NextResponse.json(
    url.searchParams.get("timings") === "1" ? { data, error: null, timings } : { data, error: null },
  );
}
