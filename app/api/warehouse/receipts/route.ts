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

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Приёмка заводится в кабинете, а склад ведётся по юрлицу: собираем партии всех
  // собственных кабинетов юрлица. Агентские сюда не попадают — товар в них чужой.
  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) {
    return NextResponse.json({ data: [], error: null });
  }

  const receiptsResult = await db
    .from("purchase_receipts")
    .select("batch_id, nm_id, expected_qty, expected_at, warehouse, received_qty, status, note, posted_at, stock_batch_id, created_by, created_at")
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
      state: "posted" as ReceiptBatchRow["state"],
      postedAt: null,
      createdAt: raw.created_at,
      createdBy: raw.created_by,
      cost: null,
    };

    current.lineCount += 1;
    current.expectedQty += Number(raw.expected_qty ?? 0);
    current.receivedQty += Number(raw.received_qty ?? 0);
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
    if (error.message.includes("warehouse belongs to another legal entity")) return fail("Склад принадлежит другому юрлицу", 400);
    if (error.message.includes("cabinet has no legal entity")) return fail("У кабинета приёмки не указано юрлицо — свяжите их в справочнике", 400);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
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
