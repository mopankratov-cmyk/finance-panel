import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import {
  isMissingMigration,
  loadTaskLines,
  MIGRATION_HINT,
  TASK_DOC_COLUMNS,
  type DbError,
  type TaskDoc,
} from "@/app/api/warehouse/tasks/taskRows";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const dbFail = (error: DbError) =>
  fail(isMissingMigration(error.code) ? MIGRATION_HINT : error.message, isMissingMigration(error.code) ? 503 : 500);

/**
 * Отменить задание. Не удаление: документ с номером остаётся в журнале со
 * статусом cancelled — «куда делось ОТГ-2026-0007» должно иметь ответ. Резерв
 * при этом снимается сам: он считается только по черновикам.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { entityId?: string; reason?: string } | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const session = await getServerSession();
  if (!session) return fail("Требуется вход", 401);
  if (!canManageStock(session.role)) return fail(OPERATOR_FORBIDDEN, 403);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const docResult = await db.from("stock_docs").select(TASK_DOC_COLUMNS).eq("id", id).maybeSingle();
  if (docResult.error) return dbFail(docResult.error);
  const doc = docResult.data as TaskDoc | null;
  if (!doc || doc.kind !== "shipment") return fail("Задание не найдено", 404);
  if (String(doc.legal_entity_id) !== scope.entity.id) return fail("Задание другого юрлица", 403);
  if (doc.status !== "draft") return fail("Задание уже выполнено или отменено", 409);

  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  const lines = await loadTaskLines(db, [doc.id]);
  const qty = lines.error ? 0 : lines.rows.reduce((sum, line) => sum + Number(line.qty), 0);

  // `.eq("status", "draft")` защищает от гонки с «Отгружено», но молча: если
  // задание успели выполнить, update просто не находит строку. Спрашиваем, что
  // именно затронуто, иначе роут ответил бы «отменено» на проведённый документ
  // и записал бы об этом событие.
  const updated = await db
    .from("stock_docs")
    .update({ status: "cancelled", note: reason ?? doc.note ?? null, updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .eq("status", "draft")
    .select("id");
  if (updated.error) {
    // 23514 — check-ограничение статуса ещё старое, без 'cancelled': значит,
    // схема не обновлена, и подсказка про миграцию точнее любого другого текста.
    if (updated.error.code === "23514") return fail(MIGRATION_HINT, 503);
    return dbFail(updated.error);
  }
  if ((updated.data ?? []).length === 0) {
    return fail("Задание уже выполнено или отменено — обновите список", 409);
  }

  const cabinetName = scope.entity.cabinets.find((link) => link.cabinetId === String(doc.cabinet_id))?.cabinetName ?? null;
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "task_cancelled",
    refType: "stock_doc",
    refId: doc.id,
    number: doc.number,
    warehouseId: doc.warehouse_id,
    actor: session.email,
    actorRole: session.role,
    payload: { cabinetName, qty, reason },
  });

  return NextResponse.json({ data: { number: doc.number }, error: null });
}
