import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { recordWarehouseEvent, type EventChange } from "@/lib/warehouse/events";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import { overReserved, type TaskLineInput } from "@/lib/warehouse/tasks";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import {
  buildTaskRows,
  isMissingMigration,
  loadAvailable,
  loadTaskLines,
  loadVariantCatalog,
  mergeLineInputs,
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
 * Править задание, пока оно черновик: состав и количества, комментарий.
 *
 * Строки не переписываются целиком, а сводятся к разнице: изменённые —
 * обновить, ушедшие — удалить, новые — вставить. Так обрыв посередине оставит
 * задание в понятном состоянии, а разница — это ровно то, что уходит в журнал
 * правок «было → стало».
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; note?: string; reason?: string; lines?: TaskLineInput[] }
    | null;
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

  // Строки правятся отдельными запросами, и между чтением статуса и записью
  // фулфилмент может нажать «Отгружено». Столбим черновик отметкой времени с
  // условием на статус: не затронуло строку — значит задание уже ушло, и
  // править его строки нельзя.
  const claimDraft = await db
    .from("stock_docs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .eq("status", "draft")
    .select("id");
  if (claimDraft.error) return dbFail(claimDraft.error);
  if ((claimDraft.data ?? []).length === 0) return fail("Задание уже выполнено или отменено", 409);
  if (!doc.warehouse_id) return fail("У задания нет склада", 400);

  const existing = await loadTaskLines(db, [doc.id]);
  if (existing.error) return dbFail(existing.error);
  const existingByVariant = new Map(existing.rows.map((line) => [String(line.variant_id), line]));

  const changes: EventChange[] = [];
  const now = new Date().toISOString();

  if (Array.isArray(body.lines)) {
    const lines = mergeLineInputs(body.lines);
    if (lines.length === 0) return fail("В задании должна остаться хотя бы одна позиция", 400);

    const catalog = await loadVariantCatalog(db, [...new Set([...lines.map((line) => line.variantId), ...existingByVariant.keys()])]);
    if (catalog.error) return dbFail(catalog.error);
    for (const line of lines) {
      if (!catalog.variants.has(line.variantId)) return fail("Размер не найден", 404);
    }
    const label = (variantId: string) => {
      const info = catalog.variants.get(variantId);
      return variantLabel(info?.article ?? "", info?.sizeLabel);
    };

    // Доступное считается без резерва этого же задания: оно правится, а не
    // конкурирует само с собой.
    const availability = await loadAvailable(db, scope.entity.id, doc.warehouse_id, lines.map((line) => line.variantId), doc.id);
    if (availability.error) return dbFail(availability.error);
    const shortage = overReserved(lines, availability.available)[0];
    if (shortage) {
      return fail(`«${label(shortage.variantId)}»: доступно ${availability.available.get(shortage.variantId) ?? 0}, в задании ${shortage.qty}`, 409);
    }

    const wanted = new Map(lines.map((line) => [line.variantId, line.qty]));
    const toInsert: { doc_id: string; variant_id: string; product_id: string | null; cabinet_id: string | null; qty: number }[] = [];
    const toUpdate: { id: number; qty: number }[] = [];
    const toDelete: number[] = [];

    for (const [variantId, qty] of wanted) {
      const prev = existingByVariant.get(variantId);
      if (!prev) {
        toInsert.push({
          doc_id: doc.id,
          variant_id: variantId,
          product_id: catalog.variants.get(variantId)?.productId ?? null,
          cabinet_id: doc.cabinet_id,
          qty,
        });
        changes.push({ line: label(variantId), field: "qty", before: 0, after: qty });
      } else if (Number(prev.qty) !== qty) {
        toUpdate.push({ id: Number(prev.id), qty });
        changes.push({ line: label(variantId), field: "qty", before: Number(prev.qty), after: qty });
      }
    }
    for (const [variantId, prev] of existingByVariant) {
      if (wanted.has(variantId)) continue;
      toDelete.push(Number(prev.id));
      changes.push({ line: label(variantId), field: "qty", before: Number(prev.qty), after: 0 });
    }

    if (toDelete.length > 0) {
      const deleted = await db.from("stock_doc_lines").delete().in("id", toDelete);
      if (deleted.error) return dbFail(deleted.error);
    }
    for (const line of toUpdate) {
      const updated = await db.from("stock_doc_lines").update({ qty: line.qty }).eq("id", line.id);
      if (updated.error) return dbFail(updated.error);
    }
    if (toInsert.length > 0) {
      const inserted = await db.from("stock_doc_lines").insert(toInsert);
      if (inserted.error) return dbFail(inserted.error);
    }
  }

  const patch: Record<string, unknown> = { updated_at: now };
  if (typeof body.note === "string") {
    const note = body.note.trim() || null;
    if (note !== (doc.note ?? null)) {
      patch.note = note;
      changes.push({ line: doc.number, field: "note", before: doc.note ?? null, after: note });
    }
  }
  const updated = await db.from("stock_docs").update(patch).eq("id", doc.id).eq("status", "draft");
  if (updated.error) return dbFail(updated.error);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cabinetName = scope.entity.cabinets.find((link) => link.cabinetId === String(doc.cabinet_id))?.cabinetName ?? null;

  // Без изменений — без события: журнал правок не должен пухнуть от «сохранить» без правок.
  if (changes.length > 0) {
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    await recordWarehouseEvent(db, {
      legalEntityId: scope.entity.id,
      kind: "task_corrected",
      refType: "stock_doc",
      refId: doc.id,
      number: doc.number,
      warehouseId: doc.warehouse_id,
      actor: session.email,
      actorRole: session.role,
      payload: { reason, cabinetName, warehouseName: names.get(String(doc.warehouse_id)) ?? null },
      changes,
    });
  }

  const fresh = await db.from("stock_docs").select(TASK_DOC_COLUMNS).eq("id", doc.id).maybeSingle();
  const freshLines = await loadTaskLines(db, [doc.id]);
  if (fresh.error) return dbFail(fresh.error);
  if (freshLines.error) return dbFail(freshLines.error);
  const built = await buildTaskRows(db, scope.entity, [(fresh.data ?? doc) as TaskDoc], freshLines.rows, names);
  if (built.error) return dbFail(built.error);
  return NextResponse.json({ data: built.rows[0] ?? null, error: null });
}
