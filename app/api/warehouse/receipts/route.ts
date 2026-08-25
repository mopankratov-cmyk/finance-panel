import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

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
}

interface DbReceipt {
  batch_id: string;
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

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

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
    const { data, error } = await db
      .from("purchase_receipts")
      .select("id, product_id, variant_id, nm_id, article, expected_qty, received_qty, defect_qty, status")
      .eq("batch_id", batchId)
      .order("id");
    if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

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
    .select("batch_id, nm_id, expected_qty, expected_at, warehouse, received_qty, defect_qty, status, note, posted_at, stock_batch_id, created_by, created_at")
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

  const grouped = new Map<string, ReceiptBatchRow>();
  for (const raw of (receiptsResult.data ?? []) as DbReceipt[]) {
    const key = String(raw.batch_id);
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
    };

    current.lineCount += 1;
    current.expectedQty += Number(raw.expected_qty ?? 0);
    current.receivedQty += Number(raw.received_qty ?? 0);
    current.defectQty += Number(raw.defect_qty ?? 0);
    if (raw.created_at < current.createdAt) current.createdAt = raw.created_at;
    if (raw.posted_at && (!current.postedAt || raw.posted_at > current.postedAt)) current.postedAt = raw.posted_at;

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
    return {
      ...row,
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
        lines?: { productId: string; variantId?: string | null; qty: number }[] }
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

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const productsResult = await db
    .from("products")
    .select("id, article, nm_id")
    .in("id", lines.map((line) => line.productId));
  if (productsResult.error) {
    const code = productsResult.error.code;
    return fail(missingMigration(code) ? migrationHint : productsResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const products = new Map((productsResult.data ?? []).map((row) => [String(row.id), row]));

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

  return NextResponse.json({ data: { batchId, lines: rows.length }, error: null }, { status: 201 });
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
  if (!body.batchId) return fail("Не указана партия приёмки", 400);
  if (body.post && !body.warehouseId) return fail("Выберите склад, на который приходуем", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);

  const existing = await db
    .from("purchase_receipts")
    .select("id, cabinet_id, status")
    .eq("batch_id", body.batchId);
  if (existing.error) {
    const code = existing.error.code;
    return fail(missingMigration(code) ? migrationHint : existing.error.message, missingMigration(code) ? 503 : 500);
  }
  const known = new Map(((existing.data ?? []) as { id: number; cabinet_id: string; status: string }[])
    .map((row) => [Number(row.id), row]));
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

  if (!body.post) {
    return NextResponse.json({ data: { saved: updates.length, posted: null }, error: null });
  }

  const { data, error } = await db.rpc("post_receipt_batch", {
    p_batch_id: body.batchId,
    p_warehouse_id: body.warehouseId,
    p_actor: session?.email ?? null,
  });
  if (error) return fail(postError(error.message) ?? error.message, 400);

  const result = (data ?? {}) as { posted?: number };
  if (!result.posted) {
    // Факт приёмки уже записан — сообщаем именно про проводку, чтобы человек не
    // вводил количества заново.
    return NextResponse.json(
      { data: { saved: updates.length, posted: 0 }, error: "Приёмка сохранена, но на остаток не встала: проводить нечего" },
      { status: 200 },
    );
  }
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
  if (!body.batchId) return fail("Не указана партия приёмки", 400);
  if (!body.warehouseId) return fail("Выберите склад, на который приходуем", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db.rpc("post_receipt_batch", {
    p_batch_id: body.batchId,
    p_warehouse_id: body.warehouseId,
    p_actor: session?.email ?? null,
  });

  if (error) {
    const known = postError(error.message);
    if (known) return fail(known, error.message.includes("not found") ? 404 : 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  const result = (data ?? {}) as { posted?: number; reason?: string; costBasis?: string; costNote?: string | null };
  if (!result.posted) {
    const reason = result.reason === "zero_quantity"
      ? "В партии нет принятых количеств — отметьте факт приёмки"
      : "Проводить нечего: строки уже проведены или ещё не приняты";
    return fail(reason, 409);
  }

  return NextResponse.json({ data: result, error: null }, { status: 201 });
}
