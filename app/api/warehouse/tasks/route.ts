import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { assertVariantsInScope } from "@/lib/warehouse/ownership";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import { overReserved, type ShipmentTasksResponse, type TaskLineInput } from "@/lib/warehouse/tasks";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import {
  buildTaskRows,
  isMissingMigration,
  loadAvailable,
  loadTaskLines,
  loadVariantCatalog,
  mergeLineInputs,
  MIGRATION_HINT,
  sortTaskRows,
  TASK_DOC_COLUMNS,
  TASK_LINE_COLUMNS,
  type DbError,
  type TaskDoc,
  type TaskDocLine,
} from "@/app/api/warehouse/tasks/taskRows";

export const dynamic = "force-dynamic";

/** Сколько дней выполненные и отменённые задания остаются в списке. */
const HISTORY_DAYS = 60;
const DOCS_LIMIT = 500;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const dbFail = (error: DbError) =>
  fail(isMissingMigration(error.code) ? MIGRATION_HINT : error.message, isMissingMigration(error.code) ? 503 : 500);

/** Список заданий: черновики ждут фулфилмента, дальше — история за два месяца. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const docsResult = await db
    .from("stock_docs")
    .select(TASK_DOC_COLUMNS)
    .eq("legal_entity_id", scope.entity.id)
    .eq("kind", "shipment")
    .or(`status.eq.draft,occurred_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(DOCS_LIMIT);
  if (docsResult.error) return dbFail(docsResult.error);
  const docs = (docsResult.data ?? []) as TaskDoc[];

  const linesResult = await loadTaskLines(db, docs.map((doc) => String(doc.id)));
  if (linesResult.error) return dbFail(linesResult.error);

  // Задание — документ со строками. Отгрузки «сейчас» и сторно тоже лежат в
  // stock_docs с kind='shipment', но строк у них нет: их место — журнал документов.
  const withLines = new Set(linesResult.rows.map((line) => String(line.doc_id)));
  const taskDocs = docs.filter((doc) => doc.status === "draft" || withLines.has(String(doc.id)));

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  const built = await buildTaskRows(db, scope.entity, taskDocs, linesResult.rows, names);
  if (built.error) return dbFail(built.error);

  const rows = sortTaskRows(built.rows);
  const payload: ShipmentTasksResponse = {
    rows,
    pending: rows.filter((row) => row.status === "draft").length,
  };
  return NextResponse.json({ data: payload, error: null });
}

/** Поставить задание фулфилменту: документ-черновик со строками, регистр не трогается. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; warehouseId?: string; cabinetId?: string; note?: string; lines?: TaskLineInput[]; docKey?: string }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const session = await getServerSession();
  if (!session) return fail("Требуется вход", 401);
  if (!canManageStock(session.role)) return fail(OPERATOR_FORBIDDEN, 403);

  if (!body.warehouseId) return fail("Выберите склад, с которого отгружаем", 400);
  const cabinet = scope.entity.cabinets.find((link) => link.cabinetId === body.cabinetId);
  if (!body.cabinetId || !cabinet) return fail(`Кабинет не связан с юрлицом «${scope.entity.name}»`, 400);

  const lines = mergeLineInputs(body.lines);
  if (lines.length === 0) return fail("Укажите хотя бы одну позицию с количеством", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehouseResult = await db.from("warehouses").select("id, name, is_active").eq("id", body.warehouseId).maybeSingle();
  if (warehouseResult.error) return dbFail(warehouseResult.error);
  if (!warehouseResult.data) return fail("Склад не найден", 404);
  if (warehouseResult.data.is_active === false) return fail("Склад в архиве", 400);
  const warehouseName = String(warehouseResult.data.name ?? "");

  // Размер обязан быть своим: иначе ошибка нехватки остатка назовёт чужой
  // артикул, и по ней перебирается весь справочник.
  const lineScope = await assertVariantsInScope(db, lines.map((line) => line.variantId), [scope.entity.id]);
  if (!lineScope.ok) return fail(lineScope.error, lineScope.status);

  // Размеры — по справочнику, а не со слов клиента: строка задания с чужим
  // вариантом развалила бы резерв тихо, не тем размером.
  const catalog = await loadVariantCatalog(db, lines.map((line) => line.variantId));
  if (catalog.error) return dbFail(catalog.error);
  for (const line of lines) {
    if (!catalog.variants.has(line.variantId)) return fail("Размер не найден", 404);
  }

  // Доступно = остаток на складе минус то, что уже держат другие черновики.
  // Два задания на одни и те же десять штук — это одно задание, которое
  // фулфилмент не сможет выполнить.
  const availability = await loadAvailable(db, scope.entity.id, body.warehouseId, lines.map((line) => line.variantId), null);
  if (availability.error) return dbFail(availability.error);
  const shortage = overReserved(lines, availability.available)[0];
  if (shortage) {
    const info = catalog.variants.get(shortage.variantId);
    const label = variantLabel(info?.article ?? "", info?.sizeLabel);
    return fail(`«${label}»: доступно ${availability.available.get(shortage.variantId) ?? 0}, в задании ${shortage.qty}`, 409);
  }

  // Ключ идемпотентности: второй клик по кнопке не должен давать второе задание.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "task", scope.entity.id, session.email);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  // Номер задание получает сразу: под ним оно висит в списке у фулфилмента и
  // под ним же станет накладной после подтверждения.
  const now = new Date().toISOString();
  const numberResult = await db.rpc("next_stock_doc_number", { p_kind: "shipment", p_at: now });
  if (numberResult.error || !numberResult.data) {
    await releaseDocKey(db, docKey);
    return numberResult.error ? dbFail(numberResult.error) : fail("Не удалось получить номер документа", 500);
  }

  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const created = await db
    .from("stock_docs")
    .insert({
      number: String(numberResult.data),
      kind: "shipment",
      status: "draft",
      legal_entity_id: scope.entity.id,
      warehouse_id: body.warehouseId,
      cabinet_id: body.cabinetId,
      note,
      occurred_at: now,
      created_by: session.email,
    })
    .select(TASK_DOC_COLUMNS)
    .single();
  if (created.error || !created.data) {
    await releaseDocKey(db, docKey);
    return created.error ? dbFail(created.error) : fail("Не удалось завести задание", 500);
  }
  const doc = created.data as TaskDoc;

  const inserted = await db
    .from("stock_doc_lines")
    .insert(lines.map((line) => ({
      doc_id: doc.id,
      variant_id: line.variantId,
      product_id: catalog.variants.get(line.variantId)?.productId ?? null,
      cabinet_id: body.cabinetId,
      qty: line.qty,
    })))
    .select(TASK_LINE_COLUMNS);
  if (inserted.error) {
    // Документ без строк — не задание, а мусор в журнале: убираем, пока он не
    // успел никому показаться.
    await db.from("stock_docs").delete().eq("id", doc.id);
    await releaseDocKey(db, docKey);
    return dbFail(inserted.error);
  }
  const docLines = (inserted.data ?? []) as TaskDocLine[];

  const qty = docLines.reduce((sum, line) => sum + Number(line.qty), 0);
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "task_created",
    refType: "stock_doc",
    refId: doc.id,
    number: doc.number,
    warehouseId: body.warehouseId,
    actor: session.email,
    actorRole: session.role,
    payload: { cabinetName: cabinet.cabinetName, warehouseName, lines: docLines.length, qty },
  });

  const names = new Map([[String(body.warehouseId), warehouseName]]);
  const built = await buildTaskRows(db, scope.entity, [doc], docLines, names);
  if (built.error || built.rows.length === 0) {
    // Задание уже создано — отдаём хотя бы номер, чтобы экран не решил, что
    // ничего не произошло, и не поставил второе.
    const minimal = { id: doc.id, number: doc.number, status: "draft", qty };
    await settleDocKey(db, docKey, minimal);
    return NextResponse.json({ data: minimal, error: null }, { status: 201 });
  }

  await settleDocKey(db, docKey, built.rows[0]);
  return NextResponse.json({ data: built.rows[0], error: null }, { status: 201 });
}
