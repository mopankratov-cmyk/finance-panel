import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import type { TaskLineInput } from "@/lib/warehouse/tasks";
import {
  isMissingMigration,
  loadTaskLines,
  MIGRATION_HINT,
  TASK_DOC_COLUMNS,
  type DbError,
  type TaskDoc,
} from "@/app/api/warehouse/tasks/taskRows";

export const dynamic = "force-dynamic";

export interface ShipTaskResult {
  docId: string;
  number: string;
  qty: number;
  amount: number;
  lines: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const dbFail = (error: DbError) =>
  fail(isMissingMigration(error.code) ? MIGRATION_HINT : error.message, isMissingMigration(error.code) ? 503 : 500);

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * «Отгружено» — фулфилмент подтверждает задание.
 *
 * Единственная запись, которая открыта оператору: проводка обычной отгрузки
 * теми же строками и закрытие того же документа — одной транзакцией в
 * post_shipment_task. Количества можно подтвердить не все (lines), но
 * добавить позицию нельзя: это правка задания, а не его выполнение.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; lines?: TaskLineInput[]; docKey?: string }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const session = await getServerSession();
  if (!session) return fail("Требуется вход", 401);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const docResult = await db.from("stock_docs").select(TASK_DOC_COLUMNS).eq("id", id).maybeSingle();
  if (docResult.error) return dbFail(docResult.error);
  const doc = docResult.data as TaskDoc | null;
  if (!doc || doc.kind !== "shipment") return fail("Задание не найдено", 404);
  if (String(doc.legal_entity_id) !== scope.entity.id) return fail("Задание другого юрлица", 403);
  if (doc.status !== "draft") return fail("Задание уже выполнено или отменено", 409);

  // Переопределение количеств: только целые неотрицательные, ноль = не отгружать.
  const overrides = Array.isArray(body.lines)
    ? body.lines
      .filter((line) => typeof line?.variantId === "string" && line.variantId && Number.isFinite(Number(line.qty)) && Number(line.qty) >= 0)
      .map((line) => ({ variantId: line.variantId, qty: Math.round(Number(line.qty)) }))
    : null;

  // Ключ идемпотентности: второй клик по «Отгружено» не должен списать товар дважды.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "task_ship", scope.entity.id, session.email);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  // План — до проводки: после неё строки уже несут shipped_qty, а событию
  // нужно «сколько было в задании», чтобы показать «80 из 100».
  const planned = await loadTaskLines(db, [doc.id]);
  const plannedQty = planned.error ? null : planned.rows.reduce((sum, line) => sum + Number(line.qty), 0);

  const { data, error } = await db.rpc("post_shipment_task", {
    p_doc_id: doc.id,
    p_actor: session.email,
    p_lines: overrides && overrides.length > 0 ? overrides : null,
  });

  if (error) await releaseDocKey(db, docKey);
  if (error) {
    const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
    if (shortage) return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    if (error.message.includes("task is not a draft")) return fail("Задание уже выполнено или отменено", 409);
    if (error.message.includes("nothing to ship")) return fail("Нечего отгружать: все количества нулевые", 400);
    // Задание — потолок: отгрузить сверх плана нельзя, это отдельная отгрузка.
    if (error.message.includes("over plan")) return fail("Больше, чем в задании, отгрузить нельзя — исправьте количества или оформите отдельную отгрузку", 409);
    if (error.message.includes("task not found")) return fail("Задание не найдено", 404);
    if (error.message.includes("not a shipment task")) return fail("Это не задание на отгрузку", 400);
    if (error.message.includes("task has no warehouse")) return fail("У задания нет склада", 400);
    if (error.message.includes("task has no cabinet")) return fail("У задания нет кабинета", 400);
    if (error.message.includes("quantity must be non-negative")) return fail("Количество не может быть отрицательным", 400);
    if (error.message.includes("quantity must be positive")) return fail("Количество должно быть больше нуля", 400);
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    return dbFail(error);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const payload: ShipTaskResult = {
    docId: doc.id,
    number: doc.number,
    qty: num(result.qty),
    amount: Math.abs(num(result.amount)),
    lines: num(result.lines),
  };

  // Событие пишется ПОСЛЕ проводки и её не отменяет: товар уже списан.
  const cabinetName = scope.entity.cabinets.find((link) => link.cabinetId === String(doc.cabinet_id))?.cabinetName ?? null;
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "task_shipped",
    refType: "stock_doc",
    refId: doc.id,
    number: doc.number,
    warehouseId: doc.warehouse_id,
    actor: session.email,
    actorRole: session.role,
    payload: {
      cabinetName,
      lines: payload.lines,
      qty: payload.qty,
      plannedQty,
      amount: payload.amount,
      createdAt: doc.created_at,
    },
  });

  await settleDocKey(db, docKey, payload);
  return NextResponse.json({ data: payload, error: null }, { status: 201 });
}
