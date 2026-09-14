import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { normalizeDiscrepancyActPayload } from "@/lib/purchases/discrepancyActs";
import { DISCREPANCY_ACT_SELECT, discrepancyActFromDb } from "@/lib/purchases/discrepancyActsDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Акты расхождений ещё не развёрнуты: примените миграцию 202609140008_discrepancy_acts.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

interface DbReceiptLine {
  expected_qty: number;
  received_qty: number | null;
  defect_qty: number | null;
  status: "expected" | "received";
}

/**
 * Расхождение партии — та же логика, что components/warehouse/ReceiptsTab.tsx
 * discrepancyOf() и роут app/api/warehouse/receipts считают для склада: недовоз
 * и излишек копятся по строкам (а не по итогам, чтобы −4 одного размера и +2
 * другого не схлопнулись в «−2»), и null, пока не все строки партии пересчитаны.
 * Здесь — та же арифметика в миниатюре, без остальных полей ReceiptBatchRow
 * (партия, себестоимость, шапка), которые этому экрану не нужны.
 */
function summarizeDiscrepancy(lines: DbReceiptLine[]) {
  let expectedQty = 0;
  let receivedQty = 0;
  let defectQty = 0;
  let short = 0;
  let over = 0;
  let counted = lines.length > 0;
  for (const line of lines) {
    expectedQty += Number(line.expected_qty ?? 0);
    receivedQty += Number(line.received_qty ?? 0);
    defectQty += Number(line.defect_qty ?? 0);
    if (line.status === "expected") { counted = false; continue; }
    const diff = Number(line.received_qty ?? 0) - Number(line.expected_qty ?? 0);
    if (diff < 0) short += -diff;
    if (diff > 0) over += diff;
  }
  return { expectedQty, receivedQty, defectQty, counted, short: counted ? short : 0, over: counted ? over : 0 };
}

async function loadOrder(db: ReturnType<typeof getSupabaseAdmin>, id: string) {
  return db!.from("purchase_orders").select("cabinet_id, receipt_batch_id").eq("id", id).maybeSingle();
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: order, error: findError } = await loadOrder(db, id);
  if (findError) return errorResponse(findError.message, 500);
  if (!order) return errorResponse("Заказ не найден", 404);
  const cabinetId = String(order.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);

  if (!order.receipt_batch_id) {
    return NextResponse.json({ data: { batchId: null, counted: false, expectedQty: 0, receivedQty: 0, defectQty: 0, short: 0, over: 0, act: null }, error: null });
  }
  const batchId = String(order.receipt_batch_id);

  // purchase_receipts уже существует и не зависит от миграции 202609140008 —
  // сами цифры расхождения обязаны быть видны, даже если таблицу актов ещё
  // не накатили. Поэтому её отсутствие не роняет весь ответ 503: без неё
  // просто нет решения (act: null), а не нет расхождения вовсе.
  const { data: lines, error: linesError } = await db.from("purchase_receipts").select("expected_qty, received_qty, defect_qty, status").eq("batch_id", batchId);
  if (linesError) return errorResponse(linesError.message, 500);

  const { data: actRow, error: actError } = await db.from("discrepancy_acts").select(DISCREPANCY_ACT_SELECT).eq("batch_id", batchId).maybeSingle();
  if (actError && !["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(actError.code ?? "")) return errorResponse(actError.message, 500);

  const summary = summarizeDiscrepancy((lines ?? []) as DbReceiptLine[]);
  return NextResponse.json({
    data: { batchId, ...summary, act: actRow ? discrepancyActFromDb(actRow as Record<string, unknown>) : null },
    error: null,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: order, error: findError } = await loadOrder(db, id);
  if (findError) return errorResponse(findError.message, 500);
  if (!order) return errorResponse("Заказ не найден", 404);
  const cabinetId = String(order.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);
  if (!order.receipt_batch_id) return errorResponse("У заказа ещё нет приёмки", 400);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);
  if (body.id) return errorResponse("Для изменения существующего акта используйте PATCH /api/discrepancy-acts/[id]", 400);

  const normalized = normalizeDiscrepancyActPayload(body, { purchaseOrderId: id, batchId: String(order.receipt_batch_id) });
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  const session = await getServerSession();
  const { data: row, error } = await db
    .from("discrepancy_acts")
    .insert({
      purchase_order_id: normalized.value.purchaseOrderId,
      batch_id: normalized.value.batchId,
      resolution: normalized.value.resolution,
      // Новый акт всегда создаётся открытым, что бы ни прислал клиент в
      // status — иначе можно завести уже «решённый» акт без resolved_by/
      // resolved_at: этот инвариант держит только PATCH, у insert его не было.
      status: "open",
      note: normalized.value.note || null,
      created_by: session?.email ?? null,
    })
    .select(DISCREPANCY_ACT_SELECT)
    .single();
  if (error) return databaseError(error);

  await db.from("operation_audit_log").insert({
    cabinet_id: cabinetId,
    entity_type: "discrepancy_act",
    entity_id: row.id,
    action: "created",
    actor: session?.email ?? null,
    before_data: null,
    after_data: row,
  });

  return NextResponse.json({ data: { act: discrepancyActFromDb(row as Record<string, unknown>) }, error: null }, { status: 201 });
}
