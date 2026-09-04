import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const migrationHint = "Примените миграции 202608240021 и 202608240022";

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Сторнировать документ.
 *
 * Не отмена и не удаление: регистр append-only, и правка в нём запрещена
 * триггером — это правильно, история не должна переписываться. Сторно пишет те
 * же строки со знаком минус и связывает их с исходным документом. В остатке
 * результат тот же, а в журнале видно и ошибку, и её исправление.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { entityId?: string; note?: string } | null;

  const scope = await resolveEntity(body?.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();
  // Сторно меняет историю — это администратор и менеджер, оператору ФФ нельзя
  // (ТЗ команды: «вернуть в остаток» — не его кнопка).
  if (!canManageStock(session?.role)) return fail(OPERATOR_FORBIDDEN, 403);

  const docResult = await db
    .from("stock_docs")
    .select("id, number, kind, status, legal_entity_id, warehouse_id, target_warehouse_id, cabinet_id, movement_doc_id, reversed_by")
    .eq("id", id)
    .maybeSingle();
  if (docResult.error) {
    const code = docResult.error.code;
    return fail(missingMigration(code) ? migrationHint : docResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const doc = docResult.data;
  if (!doc) return fail("Документ не найден", 404);
  if (String(doc.legal_entity_id) !== scope.entity.id) return fail("Документ другого юрлица", 403);
  if (doc.status === "reversed" || doc.reversed_by) return fail("Документ уже сторнирован", 409);
  if (doc.status === "draft") return fail("Черновик сторнировать нечем — он ещё не проведён", 400);
  if (doc.status === "cancelled") return fail("Задание отменено — сторнировать нечего", 400);
  // Коррекция прихода правит не только регистр, но и саму приёмку (принято,
  // брак, итог партии). Сторно вернуло бы движения, а числа приёмки остались бы
  // исправленными — и следующая коррекция считала бы дельту от того, чего в
  // регистре уже нет. Отменяют коррекцию другой коррекцией: прежними числами.
  if (doc.kind === "adjustment") {
    return fail("Коррекцию прихода отменяют новой коррекцией — верните прежние количества на вкладке «Приёмка»", 409);
  }
  if (!doc.movement_doc_id) return fail("У документа нет движений — сторнировать нечего", 400);

  // Номер сторно берём того же вида, что и исходный документ: так в журнале
  // сразу видно, чего именно касается отмена.
  const numberResult = await db.rpc("next_stock_doc_number", { p_kind: doc.kind, p_at: new Date().toISOString() });
  if (numberResult.error) {
    const code = numberResult.error.code;
    return fail(missingMigration(code) ? migrationHint : numberResult.error.message, missingMigration(code) ? 503 : 500);
  }

  const created = await db
    .from("stock_docs")
    .insert({
      number: String(numberResult.data),
      kind: doc.kind,
      status: "posted",
      legal_entity_id: scope.entity.id,
      warehouse_id: doc.warehouse_id,
      target_warehouse_id: doc.target_warehouse_id,
      cabinet_id: doc.cabinet_id,
      note: body?.note?.trim() || `Сторно ${doc.number}`,
      reverses: doc.id,
      created_by: session?.email ?? null,
    })
    .select("id, number")
    .single();
  if (created.error || !created.data) return fail(created.error?.message ?? "Не удалось завести сторно", 500);

  const movementDocId = `reversal:${created.data.id}`;
  // Кабинет документа — граница отмены. Одна проводка может держать несколько
  // накладных, и отмена поездки на Ozon не должна возвращать на склад то, что
  // уже уехало на Wildberries.
  const args = {
    p_source_movement_doc_id: doc.movement_doc_id,
    p_new_movement_doc_id: movementDocId,
    p_source_number: String(doc.number),
    p_actor: session?.email ?? null,
  };
  let { data, error } = await db.rpc("post_doc_reversal", { ...args, p_cabinet_id: doc.cabinet_id ?? null });

  // База может быть ещё без миграции с кабинетом. Для документа без кабинета
  // старая функция делает ровно то же самое — зовём её и не мешаем человеку
  // работать. А вот отдельную накладную на кабинет ею отменять нельзя: она
  // вернула бы на склад и то, что уехало по соседней.
  if (error && missingMigration(error.code)) {
    if (doc.cabinet_id) {
      await db.from("stock_docs").delete().eq("id", created.data.id);
      return fail("Примените миграцию 202608250027_doc_reversal_cabinet.sql — без неё отмена накладной задела бы соседние", 503);
    }
    ({ data, error } = await db.rpc("post_doc_reversal", args));
  }

  if (error) {
    // Движения не записались — карточку сторно убираем, иначе в журнале повиснет
    // документ без строк, и повтор упрётся в «уже сторнирован».
    await db.from("stock_docs").delete().eq("id", created.data.id);
    if (error.message.includes("already reversed")) return fail("Документ уже сторнирован", 409);
    if (error.message.includes("no movements")) return fail("У документа нет движений — сторнировать нечего", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  await db
    .from("stock_docs")
    .update({ movement_doc_id: movementDocId, result: data, updated_at: new Date().toISOString() })
    .eq("id", created.data.id);
  await db
    .from("stock_docs")
    .update({ status: "reversed", reversed_by: created.data.id, updated_at: new Date().toISOString() })
    .eq("id", doc.id);

  // Событие пишется ПОСЛЕ сторно и его не отменяет: движения уже в регистре.
  const result = (data ?? {}) as Record<string, unknown>;
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "doc_reversed",
    refType: "stock_doc",
    refId: String(created.data.id),
    number: String(created.data.number),
    warehouseId: doc.warehouse_id ? String(doc.warehouse_id) : null,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: {
      kind: doc.kind,
      reversedNumber: String(doc.number),
      qty: Math.abs(num(result.qty)),
      amount: Math.abs(num(result.amount)),
    },
  });

  return NextResponse.json({
    data: { number: String(created.data.number), reverses: String(doc.number), ...result },
    error: null,
  }, { status: 201 });
}
