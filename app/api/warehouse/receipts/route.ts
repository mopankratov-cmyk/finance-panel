import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { canManageStock } from "@/lib/warehouse/operatorScope";
import { recordWarehouseEvent } from "@/lib/warehouse/events";

export const dynamic = "force-dynamic";

/** Партия приёмки глазами склада: одна строка на batch_id, а не на SKU. */
export interface ReceiptBatchRow {
  batchId: string;
  expectedAt: string | null;
  warehouseLabel: string | null;
  note: string | null;
  lineCount: number;
  expectedQty: number;
  receivedQty: number;
  defectQty: number;
  /** ждём → приняли, но в остатке ещё нет → проведено в регистр */
  state: "expected" | "received" | "posted";
  postedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  cost: { total: number; unit: number; basis: "exact" | "estimated"; note: string | null } | null;
  /** Шапка партии (stock_receipt_batches). До миграции 202609040002 её нет — всё null. */
  number: string | null;
  supplier: string | null;
  bagsCount: number | null;
  /** Кто и когда нажал «Пересчитано». Пока null — партия не пересчитана. */
  countedAt: string | null;
  countedBy: string | null;
  /** Недовоз и излишек по строкам. null, пока в партии есть непересчитанные строки:
   *  сравнивать ожидаемое с непринятым — значит показывать расхождение там, где его ещё нет. */
  discrepancy: { short: number; over: number } | null;
  /** В партии есть товар с признаком «новинка». */
  hasNovelty: boolean;
}

interface DbReceipt {
  batch_id: string;
  product_id: string | null;
  nm_id: number;
  expected_qty: number;
  expected_at: string | null;
  warehouse: string | null;
  received_qty: number | null;
  defect_qty: number | null;
  status: "expected" | "received";
  note: string | null;
  posted_at: string | null;
  stock_batch_id: string | null;
  created_by: string | null;
  created_at: string;
}

interface DbBatch {
  id: string;
  receipt_batch_id: string;
  total_amount: number;
  total_qty: number;
  cost_basis: "exact" | "estimated";
  cost_note: string | null;
}

interface DbBatchHeader {
  batch_id: string;
  number: string | null;
  supplier: string | null;
  bags_count: number | null;
  counted_at: string | null;
  counted_by: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

/** Фильтр `in` едет в URL запроса: длинный список партий режем на куски. */
const CHUNK = 200;

export interface ReceiptLineRow {
  id: number;
  productId: string | null;
  variantId: string | null;
  nmId: number | null;
  article: string;
  /** Размер. Пустой у безразмерного товара — крема, сумки, пенала. */
  sizeLabel: string;
  /** Чем позиция отзывается на сканер. Без баркода строку можно только вбить руками. */
  barcode: string | null;
  photoUrl: string | null;
  expectedQty: number;
  receivedQty: number | null;
  defectQty: number;
  status: "expected" | "received";
  /** Когда строка встала на остаток; null — ещё не проведена. По ней коррекция
   *  понимает, править ли числа напрямую или писать дельты в регистр. */
  postedAt: string | null;
}

/** Шапки партий одним проходом. До миграции 202609040002 таблицы нет — партии
 *  остаются без номера и поставщика, а список работает как раньше: любая ошибка
 *  здесь означает «шапок нет», а не «список сломан». */
async function loadBatchHeaders(db: SupabaseClient, batchIds: string[]): Promise<Map<string, DbBatchHeader>> {
  const headers = new Map<string, DbBatchHeader>();
  for (let i = 0; i < batchIds.length; i += CHUNK) {
    const { data, error } = await db
      .from("stock_receipt_batches")
      .select("batch_id, number, supplier, bags_count, counted_at, counted_by")
      .in("batch_id", batchIds.slice(i, i + CHUNK));
    if (error) return headers;
    for (const row of (data ?? []) as DbBatchHeader[]) headers.set(String(row.batch_id), row);
  }
  return headers;
}

/** Товары-новинки среди указанных. Колонки is_novelty до миграции нет — тогда новинок нет. */
async function loadNoveltyProducts(db: SupabaseClient, productIds: string[]): Promise<Set<string>> {
  const novelty = new Set<string>();
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const { data, error } = await db
      .from("products")
      .select("id")
      .in("id", productIds.slice(i, i + CHUNK))
      .eq("is_novelty", true);
    if (error) return novelty;
    for (const row of data ?? []) novelty.add(String(row.id));
  }
  return novelty;
}

async function warehouseNameOf(db: SupabaseClient, warehouseId: string | null | undefined): Promise<string | null> {
  if (!warehouseId) return null;
  const { data } = await db.from("warehouses").select("name").eq("id", warehouseId).maybeSingle();
  return data?.name ? String(data.name) : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const url = new URL(request.url);
  const scope = await resolveEntity(url.searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Строки одной партии — для формы приёма: оператор вводит принято/брак по позициям.
  const batchId = url.searchParams.get("batch");
  if (batchId) {
    // Партия читается только своя: идентификатор приходит из адреса, и без
    // этой проверки менеджер с доступом к одному юрлицу читал бы подбором id
    // чужие приёмки — с ценами и количествами.
    const own = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
    if (own.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 403);
    const { data, error } = await db
      .from("purchase_receipts")
      .select("id, cabinet_id, product_id, variant_id, nm_id, article, expected_qty, received_qty, defect_qty, status, posted_at")
      .eq("batch_id", batchId)
      .in("cabinet_id", own)
      .order("id");
    if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
    if ((data ?? []).length === 0) return fail("Партия не найдена", 404);

    // Размер и баркод — из справочника вариантов: в строке приёмки лежит только
    // ссылка, а сканеру нужен именно баркод, и он живёт на размере, не на модели.
    const variantIds = [...new Set((data ?? []).map((row) => row.variant_id).filter(Boolean).map(String))];
    const productIds = [...new Set((data ?? []).map((row) => row.product_id).filter(Boolean).map(String))];
    const [variantsResult, productsResult] = await Promise.all([
      variantIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db.from("product_variants").select("id, size_label, barcode").in("id", variantIds),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db.from("products").select("id, photo_url").in("id", productIds),
    ]);
    const variants = new Map(((variantsResult.data ?? []) as { id: string; size_label: string | null; barcode: string | null }[])
      .map((row) => [String(row.id), row]));
    const photos = new Map(((productsResult.data ?? []) as { id: string; photo_url: string | null }[])
      .map((row) => [String(row.id), row.photo_url]));

    const lines: ReceiptLineRow[] = (data ?? []).map((row) => {
      const variant = row.variant_id ? variants.get(String(row.variant_id)) : undefined;
      return {
        id: Number(row.id),
        productId: row.product_id ? String(row.product_id) : null,
        variantId: row.variant_id ? String(row.variant_id) : null,
        nmId: row.nm_id === null ? null : Number(row.nm_id),
        article: String(row.article ?? ""),
        sizeLabel: String(variant?.size_label ?? ""),
        barcode: variant?.barcode ?? null,
        photoUrl: row.product_id ? (photos.get(String(row.product_id)) ?? null) : null,
        expectedQty: Number(row.expected_qty ?? 0),
        receivedQty: row.received_qty === null ? null : Number(row.received_qty),
        defectQty: Number(row.defect_qty ?? 0),
        status: row.status === "received" ? "received" : "expected",
        postedAt: row.posted_at ? String(row.posted_at) : null,
      };
    });
    return NextResponse.json({ data: lines, error: null });
  }

  // Приёмка заводится в кабинете, а склад ведётся по юрлицу: собираем партии всех
  // собственных кабинетов юрлица. Агентские сюда не попадают — товар в них чужой.
  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) {
    return NextResponse.json({ data: [], error: null });
  }

  const receiptsResult = await db
    .from("purchase_receipts")
    .select("batch_id, product_id, nm_id, expected_qty, expected_at, warehouse, received_qty, defect_qty, status, note, posted_at, stock_batch_id, created_by, created_at")
    .in("cabinet_id", ownCabinets)
    .order("created_at", { ascending: false });

  if (receiptsResult.error) {
    const code = receiptsResult.error.code;
    return fail(missingMigration(code) ? migrationHint : receiptsResult.error.message, missingMigration(code) ? 503 : 500);
  }

  const batchesResult = await db
    .from("stock_batches")
    .select("id, receipt_batch_id, total_amount, total_qty, cost_basis, cost_note")
    .eq("legal_entity_id", scope.entity.id);
  if (batchesResult.error) {
    const code = batchesResult.error.code;
    return fail(missingMigration(code) ? migrationHint : batchesResult.error.message, missingMigration(code) ? 503 : 500);
  }

  const costs = new Map<string, DbBatch>();
  for (const row of (batchesResult.data ?? []) as DbBatch[]) costs.set(String(row.receipt_batch_id), row);

  const receipts = (receiptsResult.data ?? []) as DbReceipt[];
  const productIds = [...new Set(receipts.map((row) => row.product_id).filter(Boolean).map(String))];
  const [headers, novelty] = await Promise.all([
    loadBatchHeaders(db, [...new Set(receipts.map((row) => String(row.batch_id)))]),
    loadNoveltyProducts(db, productIds),
  ]);

  // Расхождение копится по строкам, а не по итогам: недовоз одного размера и
  // излишек другого в сумме дают ноль, хотя оба — повод для акта.
  const gaps = new Map<string, { short: number; over: number; pending: boolean }>();

  const grouped = new Map<string, ReceiptBatchRow>();
  for (const raw of receipts) {
    const key = String(raw.batch_id);
    const header = headers.get(key);
    const current = grouped.get(key) ?? {
      batchId: key,
      expectedAt: raw.expected_at,
      warehouseLabel: raw.warehouse,
      note: raw.note,
      lineCount: 0,
      expectedQty: 0,
      receivedQty: 0,
      defectQty: 0,
      state: "posted" as ReceiptBatchRow["state"],
      postedAt: null,
      createdAt: raw.created_at,
      createdBy: raw.created_by,
      cost: null,
      number: header?.number ?? null,
      supplier: header?.supplier ?? null,
      bagsCount: header?.bags_count === null || header?.bags_count === undefined ? null : Number(header.bags_count),
      countedAt: header?.counted_at ?? null,
      countedBy: header?.counted_by ?? null,
      discrepancy: null,
      hasNovelty: false,
    };

    current.lineCount += 1;
    current.expectedQty += Number(raw.expected_qty ?? 0);
    current.receivedQty += Number(raw.received_qty ?? 0);
    current.defectQty += Number(raw.defect_qty ?? 0);
    if (raw.created_at < current.createdAt) current.createdAt = raw.created_at;
    if (raw.posted_at && (!current.postedAt || raw.posted_at > current.postedAt)) current.postedAt = raw.posted_at;
    if (raw.product_id && novelty.has(String(raw.product_id))) current.hasNovelty = true;

    const gap = gaps.get(key) ?? { short: 0, over: 0, pending: false };
    if (raw.status === "expected") {
      gap.pending = true;
    } else {
      const diff = Number(raw.received_qty ?? 0) - Number(raw.expected_qty ?? 0);
      if (diff < 0) gap.short += -diff;
      if (diff > 0) gap.over += diff;
    }
    gaps.set(key, gap);

    // Состояние партии = состояние самой отстающей строки: пока хоть одна ждёт,
    // партия ждёт; пока хоть одна не проведена, партия не в остатке.
    const lineState: ReceiptBatchRow["state"] = raw.status === "expected"
      ? "expected"
      : raw.posted_at
        ? "posted"
        : "received";
    const rank = { expected: 0, received: 1, posted: 2 } as const;
    if (rank[lineState] < rank[current.state]) current.state = lineState;

    grouped.set(key, current);
  }

  const rows = [...grouped.values()].map((row) => {
    const cost = costs.get(row.batchId);
    const gap = gaps.get(row.batchId);
    return {
      ...row,
      discrepancy: gap && !gap.pending ? { short: gap.short, over: gap.over } : null,
      cost: cost
        ? {
          total: Number(cost.total_amount),
          unit: Number(cost.total_qty) > 0 ? Number(cost.total_amount) / Number(cost.total_qty) : 0,
          basis: cost.cost_basis,
          note: cost.cost_note,
        }
        : null,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ data: rows, error: null });
}

/** Завести ожидаемую поставку: строки по товарам справочника, без обращения к «Закупкам». */
export async function PUT(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; cabinetId?: string; expectedAt?: string; note?: string;
        supplier?: string; bagsCount?: number | string | null; number?: string;
        lines?: { productId: string; variantId?: string | null; qty: number; novelty?: boolean }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  // Приёмка живёт в кабинете (так устроена purchase_receipts), поэтому нужен один
  // из собственных кабинетов юрлица — агентский чужой товар принимать не может.
  //
  // Кабинет здесь — только отметка в аудите: юрлицо приёмки задано явно, и от
  // выбора кабинета ни остаток, ни себестоимость не зависят. Но выбор всё равно
  // должен быть предсказуемым: раньше брался первый попавшийся из базы, и с
  // подключением Ozon партия могла оказаться заведена в кабинете другого
  // маркетплейса просто из-за порядка строк.
  const own = scope.entity.cabinets.filter((link) => link.relation === "own");
  const ownIds = own.map((link) => link.cabinetId);
  const fallback = (own.find((link) => link.marketplace === "wb") ?? own[0])?.cabinetId;
  const cabinetId = body.cabinetId && ownIds.includes(body.cabinetId) ? body.cabinetId : fallback;
  if (!cabinetId) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);

  const lines = (body.lines ?? []).filter((line) => Number(line.qty) > 0 && line.productId);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию с количеством", 400);

  const bagsRaw = body.bagsCount === null || body.bagsCount === undefined || body.bagsCount === "" ? null : Number(body.bagsCount);
  if (bagsRaw !== null && (!Number.isFinite(bagsRaw) || bagsRaw < 0)) return fail("Число мешков не может быть отрицательным", 400);
  const bagsCount = bagsRaw === null ? null : Math.round(bagsRaw);
  const supplier = String(body.supplier ?? "").trim() || null;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const productsResult = await db
    .from("products")
    .select("id, article, nm_id, legal_entity_id")
    .in("id", lines.map((line) => line.productId));
  if (productsResult.error) {
    const code = productsResult.error.code;
    return fail(missingMigration(code) ? migrationHint : productsResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const products = new Map((productsResult.data ?? []).map((row) => [String(row.id), row]));

  // Товар приёмки — свой или ничей: идентификаторы приходят из тела запроса, и
  // без проверки в партию юрлица попал бы чужой товар, а признак «новинка»
  // проставился бы в чужой карточке.
  for (const line of lines) {
    const product = products.get(line.productId) as { legal_entity_id?: string | null } | undefined;
    if (!product) return fail("Товар не найден", 404);
    const owner = product.legal_entity_id ? String(product.legal_entity_id) : null;
    if (owner && owner !== scope.entity.id) return fail("Товар принадлежит другому юрлицу", 403);
  }

  // Размер проверяем по справочнику, а не по слову клиента: строка приёмки с
  // чужим вариантом развалила бы остаток тихо — не тем размером на складе.
  const wantedVariants = [...new Set(lines.map((line) => line.variantId).filter(Boolean).map(String))];
  const variantOwner = new Map<string, string>();
  if (wantedVariants.length > 0) {
    const variantsResult = await db.from("product_variants").select("id, product_id").in("id", wantedVariants);
    if (variantsResult.error) {
      const code = variantsResult.error.code;
      return fail(missingMigration(code) ? migrationHint : variantsResult.error.message, missingMigration(code) ? 503 : 500);
    }
    for (const row of (variantsResult.data ?? []) as { id: string; product_id: string }[]) {
      variantOwner.set(String(row.id), String(row.product_id));
    }
    for (const line of lines) {
      if (!line.variantId) continue;
      if (variantOwner.get(String(line.variantId)) !== line.productId) {
        return fail("Размер не принадлежит выбранному товару", 400);
      }
    }
  }

  const batchId = crypto.randomUUID();
  const rows = lines.map((line) => {
    const product = products.get(line.productId);
    return {
      batch_id: batchId,
      cabinet_id: cabinetId,
      product_id: line.productId,
      variant_id: line.variantId ?? null,
      nm_id: product?.nm_id ?? null,
      article: String(product?.article ?? ""),
      expected_qty: Math.round(line.qty),
      expected_at: body.expectedAt || null,
      note: body.note?.trim() || null,
      created_by: session?.email ?? null,
    };
  });

  const { error } = await db.from("purchase_receipts").insert(rows);
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  // Шапка партии пишется ПОСЛЕ строк и их не отменяет: партия уже заведена, и
  // отказ из-за шапки (таблицы ещё нет, номер занят) соврал бы про неудачу.
  // Без шапки партия просто останется безымянной.
  let number: string | null = String(body.number ?? "").trim() || null;
  if (!number) {
    const numberResult = await db.rpc("next_stock_doc_number", { p_kind: "receipt", p_at: new Date().toISOString() });
    number = numberResult.error || !numberResult.data ? null : String(numberResult.data);
  }
  let headerError: string | null = null;
  const header = await db.from("stock_receipt_batches").insert({
    batch_id: batchId,
    legal_entity_id: scope.entity.id,
    number,
    supplier,
    bags_count: bagsCount,
    created_by: session?.email ?? null,
  });
  if (header.error) {
    // Занятый номер — единственная ошибка шапки, о которой человеку стоит знать:
    // он его вводил руками. Остальное (таблицы нет до миграции) — молча.
    if (header.error.code === "23505" && number) headerError = `Номер «${number}» уже занят — партия заведена без номера`;
    number = null;
  }

  // Новинка — признак товара, а не строки: ставится один раз и остаётся.
  // Колонки до миграции нет — тогда признак просто не запишется.
  // Оператор фулфилмента приёмку заводит, но справочник не правит: флаг новинки
  // от него не принимаем — по ТЗ это отметка администратора для запуска в РНП.
  const noveltyProducts = canManageStock(session?.role)
    ? [...new Set(lines.filter((line) => line.novelty).map((line) => line.productId))]
    : [];
  if (noveltyProducts.length > 0) {
    await db.from("products").update({ is_novelty: true, updated_at: new Date().toISOString() }).in("id", noveltyProducts);
  }

  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "receipt_created",
    refType: "receipt_batch",
    refId: batchId,
    number,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: {
      supplier,
      bagsCount,
      qty: rows.reduce((sum, row) => sum + row.expected_qty, 0),
      lines: rows.length,
      novelty: noveltyProducts.map((id) => String(products.get(id)?.article ?? "")).filter(Boolean),
    },
  });

  return NextResponse.json({ data: { batchId, lines: rows.length, number }, error: headerError }, { status: 201 });
}

/** Отметить факт приёмки по всей партии разом и, если попросили, сразу поставить
 *  её на остаток.
 *
 *  Раньше окно приёма било строки по одной: сто позиций — сто запросов, и обрыв
 *  на пятидесятой оставлял партию наполовину принятой без всякого следа о том,
 *  где она встала. Здесь партия — один документ: либо принята вся, либо ни одной
 *  строки. */
export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | {
        entityId?: string;
        batchId?: string;
        warehouseId?: string;
        post?: boolean;
        lines?: { id: number; receivedQty: number; defectQty?: number }[];
      }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const batchId = body.batchId;
  if (!batchId) return fail("Не указана партия приёмки", 400);
  if (body.post && !body.warehouseId) return fail("Выберите склад, на который приходуем", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);

  const existing = await db
    .from("purchase_receipts")
    .select("id, cabinet_id, status, expected_qty, received_qty, defect_qty, created_at")
    .eq("batch_id", batchId);
  if (existing.error) {
    const code = existing.error.code;
    return fail(missingMigration(code) ? migrationHint : existing.error.message, missingMigration(code) ? 503 : 500);
  }
  type KnownLine = {
    id: number; cabinet_id: string; status: string;
    expected_qty: number; received_qty: number | null; defect_qty: number | null; created_at: string;
  };
  const known = new Map(((existing.data ?? []) as KnownLine[]).map((row) => [Number(row.id), row]));
  if (known.size === 0) return fail("Партия не найдена", 404);
  // Партия целиком принадлежит кабинету юрлица — проверяем до записи, а не по строке.
  for (const row of known.values()) {
    if (!ownCabinets.includes(String(row.cabinet_id))) return fail("Партия принадлежит другому юрлицу", 403);
  }

  const now = new Date().toISOString();
  const updates: { id: number; received: number; defect: number }[] = [];
  for (const line of body.lines ?? []) {
    const row = known.get(Number(line.id));
    if (!row) return fail("В партии нет такой позиции", 400);
    if (row.status !== "expected") continue; // уже принято — повторный ввод не трогаем
    const received = Math.round(Number(line.receivedQty));
    const defect = Math.max(0, Math.round(Number(line.defectQty ?? 0)));
    if (!Number.isFinite(received) || received < 0) return fail("Некорректное количество", 400);
    if (defect > received) return fail("Брака больше, чем принято", 400);
    updates.push({ id: Number(line.id), received, defect });
  }

  for (const line of updates) {
    const { error } = await db
      .from("purchase_receipts")
      .update({
        received_qty: line.received,
        defect_qty: line.defect,
        received_at: now,
        status: "received",
        updated_at: now,
      })
      .eq("id", line.id)
      .eq("status", "expected");
    if (error) return fail(error.message, 500);
  }

  // Отметка «пересчитано» — в шапке партии. Шапки может не быть (партия старше
  // миграции или заведена без неё) — тогда заводим без номера. Таблицы нет
  // вовсе — отметка теряется, приёмка от этого не ломается.
  const counted = updates.length > 0;
  if (counted) {
    await db
      .from("stock_receipt_batches")
      .upsert(
        { batch_id: batchId, legal_entity_id: scope.entity.id, counted_at: now, counted_by: session?.email ?? null, updated_at: now },
        { onConflict: "batch_id" },
      );
  }

  // Итоги партии после записи — для хроники. Ожидаемое считаем по всем строкам,
  // принятое — по уже принятым и только что записанным; строка, которая всё ещё
  // ждёт, делает вывод о расхождении преждевременным.
  const updatedById = new Map(updates.map((line) => [line.id, line]));
  const totals = { expected: 0, received: 0, defect: 0, short: 0, over: 0, pending: 0 };
  let firstCreatedAt: string | null = null;
  for (const row of known.values()) {
    const expected = Number(row.expected_qty ?? 0);
    totals.expected += expected;
    const fresh = updatedById.get(Number(row.id));
    let received: number | null = null;
    if (fresh) {
      received = fresh.received;
      totals.defect += fresh.defect;
    } else if (row.status === "received") {
      received = Number(row.received_qty ?? 0);
      totals.defect += Number(row.defect_qty ?? 0);
    } else {
      totals.pending += 1;
    }
    if (received !== null) {
      totals.received += received;
      if (received < expected) totals.short += expected - received;
      if (received > expected) totals.over += received - expected;
    }
    if (!firstCreatedAt || row.created_at < firstCreatedAt) firstCreatedAt = row.created_at;
  }

  const [headers, warehouseName] = await Promise.all([
    loadBatchHeaders(db, [batchId]),
    warehouseNameOf(db, body.warehouseId),
  ]);
  const number = headers.get(batchId)?.number ?? null;
  const eventBase = {
    legalEntityId: scope.entity.id,
    refType: "receipt_batch" as const,
    refId: batchId,
    number,
    warehouseId: body.warehouseId ?? null,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
  };

  // «Пересчитано» пишется и тогда, когда проводка следом не прошла: факт
  // пересчёта уже состоялся. А вот «на остаток» в нём — только если правда встала.
  const recordCount = async (posted: boolean) => {
    if (!counted) return;
    await recordWarehouseEvent(db, {
      ...eventBase,
      kind: "receipt_counted",
      payload: {
        expected: totals.expected, received: totals.received, defect: totals.defect,
        warehouseName, posted, createdAt: firstCreatedAt,
      },
    });
    if (totals.pending === 0 && totals.received !== totals.expected) {
      await recordWarehouseEvent(db, {
        ...eventBase,
        kind: "receipt_discrepancy",
        payload: { expected: totals.expected, received: totals.received, short: totals.short, over: totals.over },
      });
    }
  };

  if (!body.post) {
    await recordCount(false);
    return NextResponse.json({ data: { saved: updates.length, posted: null }, error: null });
  }

  const { data, error } = await db.rpc("post_receipt_batch", {
    p_batch_id: batchId,
    p_warehouse_id: body.warehouseId,
    p_actor: session?.email ?? null,
  });
  if (error) {
    await recordCount(false);
    return fail(postError(error.message) ?? error.message, 400);
  }

  const result = (data ?? {}) as { posted?: number; qty?: number; total?: number; costBasis?: string };
  await recordCount(Boolean(result.posted));
  if (!result.posted) {
    // Факт приёмки уже записан — сообщаем именно про проводку, чтобы человек не
    // вводил количества заново.
    return NextResponse.json(
      { data: { saved: updates.length, posted: 0 }, error: "Приёмка сохранена, но на остаток не встала: проводить нечего" },
      { status: 200 },
    );
  }
  await recordWarehouseEvent(db, {
    ...eventBase,
    kind: "receipt_posted",
    payload: { qty: result.qty ?? null, total: result.total ?? null, costBasis: result.costBasis ?? null, warehouseName },
  });
  return NextResponse.json({ data: { saved: updates.length, posted: result, warehouseId: body.warehouseId }, error: null });
}

/** Человеческие имена ошибок проводки — общие для одиночной и совмещённой. */
function postError(message: string): string | null {
  if (message.includes("warehouse belongs to another legal entity")) return "Склад принадлежит другому юрлицу";
  if (message.includes("cabinet has no legal entity")) return "У кабинета приёмки не указано юрлицо — свяжите их в справочнике";
  if (message.includes("warehouse not found")) return "Склад не найден";
  if (message.includes("warehouse is archived")) return "Склад в архиве";
  if (message.includes("defect exceeds received")) return "В партии брака больше, чем принято";
  return null;
}

/** Провести партию на склад: посчитать себестоимость и записать приход в регистр. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; batchId?: string; warehouseId?: string }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const batchId = body.batchId;
  if (!batchId) return fail("Не указана партия приёмки", 400);
  if (!body.warehouseId) return fail("Выберите склад, на который приходуем", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Та же проверка, что и при пересчёте: провести можно только партию своих
  // кабинетов. Без неё чужая партия встала бы на наш склад по одному id.
  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);
  const owner = await db.from("purchase_receipts").select("cabinet_id").eq("batch_id", batchId).limit(50);
  if (owner.error) return fail(owner.error.message, 500);
  if ((owner.data ?? []).length === 0) return fail("Партия не найдена", 404);
  for (const row of owner.data ?? []) {
    if (!ownCabinets.includes(String(row.cabinet_id))) return fail("Партия принадлежит другому юрлицу", 403);
  }

  const { data, error } = await db.rpc("post_receipt_batch", {
    p_batch_id: batchId,
    p_warehouse_id: body.warehouseId,
    p_actor: session?.email ?? null,
  });

  if (error) {
    const known = postError(error.message);
    if (known) return fail(known, error.message.includes("not found") ? 404 : 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  const result = (data ?? {}) as { posted?: number; reason?: string; qty?: number; total?: number; costBasis?: string; costNote?: string | null };
  if (!result.posted) {
    const reason = result.reason === "zero_quantity"
      ? "В партии нет принятых количеств — отметьте факт приёмки"
      : "Проводить нечего: строки уже проведены или ещё не приняты";
    return fail(reason, 409);
  }

  const [headers, warehouseName] = await Promise.all([
    loadBatchHeaders(db, [batchId]),
    warehouseNameOf(db, body.warehouseId),
  ]);
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "receipt_posted",
    refType: "receipt_batch",
    refId: batchId,
    number: headers.get(batchId)?.number ?? null,
    warehouseId: body.warehouseId,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: { qty: result.qty ?? null, total: result.total ?? null, costBasis: result.costBasis ?? null, warehouseName },
  });

  return NextResponse.json({ data: result, error: null }, { status: 201 });
}
