import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities, resolveEntity } from "@/lib/warehouse/entityAccess";
import { assertVariantsInScope } from "@/lib/warehouse/ownership";
import { recordWarehouseEvent } from "@/lib/warehouse/events";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import { recordStockDoc } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;
/** Фильтр `in` едет в URL запроса: длинный список документов режем на куски. */
const CHUNK = 200;

export interface WriteoffRow {
  id: number;
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  productId: string;
  nmId: number | null;
  article: string;
  sizeLabel: string;
  qty: number;
  /** Строка вернула товар в остаток (сторно), а не списала его. */
  restored: boolean;
  amount: number;
  reason: string | null;
  /** Откуда списание: writeoff (руками), purchase_receipt (брак при приёмке),
   *  receipt_correction (коррекция прихода), return, reversal (сторно). */
  docType: string;
  occurredAt: string;
  createdBy: string | null;
  /** Документ списания в stock_docs — им делается сторно. null у брака при
   *  приёмке, коррекции и старых записей без документа. */
  docId: string | null;
  docNumber: string | null;
  /** Документ уже сторнирован — товар вернулся в остаток. */
  reversed: boolean;
  /** Можно вернуть в остаток: есть документ, он не сторнирован и это ручное списание. */
  canRevert: boolean;
}

export interface WriteoffsResponse {
  rows: WriteoffRow[];
  monthQty: number;
  monthAmount: number;
  truncated: boolean;
}

interface DbWriteoffDoc {
  id: string;
  number: string;
  status: string;
  reversed_by: string | null;
  movement_doc_id: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230012_defects_writeoffs.sql";

/** Функции с такой сигнатурой нет: PostgREST не нашёл её в кэше схемы
 *  (PGRST202) или Postgres не подобрал перегрузку (42883). */
const isMissingFunction = (error: { code?: string; message: string }) =>
  error.code === "PGRST202" || error.code === "42883" || /does not exist|could not find the function/i.test(error.message);

/** Документы списаний по идентификаторам движений. Ошибка (таблицы ещё нет) —
 *  просто документов нет, журнал от этого не ложится. */
async function loadWriteoffDocs(db: SupabaseClient, movementIds: string[]): Promise<Map<string, DbWriteoffDoc>> {
  const docs = new Map<string, DbWriteoffDoc>();
  for (let i = 0; i < movementIds.length; i += CHUNK) {
    const { data, error } = await db
      .from("stock_docs")
      .select("id, number, status, reversed_by, movement_doc_id")
      .eq("kind", "writeoff")
      .in("movement_doc_id", movementIds.slice(i, i + CHUNK));
    if (error) return docs;
    for (const row of (data ?? []) as DbWriteoffDoc[]) {
      if (row.movement_doc_id) docs.set(String(row.movement_doc_id), row);
    }
  }
  return docs;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  const { data, error } = await db
    .from("stock_moves")
    .select("id, warehouse_id, variant_id, product_id, nm_id, article, qty, amount, note, doc_type, doc_id, occurred_at, created_by")
    .eq("legal_entity_id", scope.entity.id)
    .eq("kind", "writeoff")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  // Размер подтягиваем одним запросом: журнал должен называть, какой именно размер списан.
  const variantIds = [...new Set((data ?? []).map((row) => String(row.variant_id)).filter(Boolean))];
  const sizes = new Map<string, string>();
  if (variantIds.length > 0) {
    const variants = await db.from("product_variants").select("id, size_label").in("id", variantIds);
    for (const variant of variants.data ?? []) sizes.set(String(variant.id), String(variant.size_label ?? ""));
  }

  // Документ списания — по идентификатору движений: по нему кнопка «Вернуть в
  // остаток» находит, что сторнировать, и по нему же видно, что уже сторнировано.
  const movementIds = [...new Set((data ?? []).map((row) => (row.doc_id ? String(row.doc_id) : "")).filter(Boolean))];
  const docs = await loadWriteoffDocs(db, movementIds);

  const rows: WriteoffRow[] = (data ?? []).map((row) => {
    const docType = String(row.doc_type);
    const doc = row.doc_id ? docs.get(String(row.doc_id)) : undefined;
    const reversed = doc ? doc.status === "reversed" || Boolean(doc.reversed_by) : false;
    return {
      id: Number(row.id),
      warehouseId: String(row.warehouse_id),
      warehouseName: names.get(String(row.warehouse_id)) ?? "склад удалён",
      variantId: String(row.variant_id),
      productId: String(row.product_id),
      nmId: row.nm_id === null ? null : Number(row.nm_id),
      article: String(row.article ?? ""),
      sizeLabel: sizes.get(String(row.variant_id)) ?? "",
      qty: Math.abs(Number(row.qty)),
      amount: Math.abs(Number(row.amount)),
      // Сторно пишет ту же строку с плюсом: в журнале это возврат в остаток, и
      // показывать его красным как потерю — врать про минус, которого не было.
      restored: Number(row.qty) > 0,
      reason: row.note,
      docType,
      occurredAt: String(row.occurred_at),
      createdBy: row.created_by,
      docId: doc ? String(doc.id) : null,
      docNumber: doc ? String(doc.number) : null,
      reversed,
      canRevert: Boolean(doc) && !reversed && docType === "writeoff",
    };
  });

  // Итог месяца считается ОТДЕЛЬНЫМ запросом по всем строкам месяца, а не по
  // выданной странице. Раньше он складывался из последних двухсот записей: пока
  // списаний мало, цифра совпадала, а на двести первой начинала молча занижать —
  // и это та самая сумма, которая заявлена как потери склада в ОПиУ.
  //
  // Складываем со знаком: сторно пишет те же строки с плюсом, и «вернули в
  // остаток» должно вычитаться из потерь, а не удваивать их.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthResult = await db
    .from("stock_moves")
    .select("qty, amount")
    .eq("legal_entity_id", scope.entity.id)
    .eq("kind", "writeoff")
    .gte("occurred_at", monthStart.toISOString());
  if (monthResult.error) return fail(monthResult.error.message, 500);

  const payload: WriteoffsResponse = {
    rows,
    monthQty: Math.max(0, -(monthResult.data ?? []).reduce((sum, row) => sum + Number(row.qty), 0)),
    monthAmount: Math.max(0, -(monthResult.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0)),
    truncated: rows.length === PAGE_SIZE,
  };
  return NextResponse.json({ data: payload, error: null });
}

/** Ручное списание: порча, недостача — всё, что всплыло позже приёмки. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; docKey?: string; warehouseId?: string; reason?: string; occurredAt?: string;
        lines?: { variantId: string; qty: number }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад", 400);
  const reason = String(body.reason ?? "").trim();
  if (!reason) return fail("Укажите причину списания — «просто пропало» не бывает", 400);

  // Дата брака по ТЗ: найденное в апреле вносят в мае, а в журнале оно должно
  // стоять апрелем. Пусто — сегодня, как раньше.
  const occurredAtRaw = typeof body.occurredAt === "string" ? body.occurredAt.trim() : "";
  let occurredAt: string | null = null;
  if (occurredAtRaw) {
    // Форма отдаёт «2026-04-24» — это день, а не момент. Полночь тут опасна с
    // обеих сторон: `new Date("2026-04-24")` даёт полночь UTC (в Москве это
    // 03:00 того же дня — терпимо), а местная полночь на сервере в UTC
    // превратилась бы в 23-е число. Берём середину дня: тогда дата читается
    // одинаково в любом часовом поясе, где работают склад и панель.
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(occurredAtRaw);
    const parsed = new Date(dayOnly ? `${occurredAtRaw}T12:00:00Z` : occurredAtRaw);
    if (Number.isNaN(parsed.getTime())) return fail("Некорректная дата списания", 400);
    if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return fail("Дата списания в будущем", 400);
    occurredAt = parsed.toISOString();
  }

  const lines = (body.lines ?? []).filter((line) => line.variantId && Number(line.qty) > 0);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Размеры приходят идентификаторами из тела. Чужой размер надо отсечь до
  // проводки: иначе функция вернёт ошибку с чужим артикулом, и по ней можно
  // перебрать весь справочник.
  const scopeList = await listAccessibleEntities();
  if (!scopeList.ok) return fail(scopeList.error, scopeList.status);
  const lineScope = await assertVariantsInScope(db, lines.map((line) => line.variantId), scopeList.rows.map((row) => row.id));
  if (!lineScope.ok) return fail(lineScope.error, lineScope.status);

  // Ключ идемпотентности: второй клик по кнопке не должен давать второй документ.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "writeoff", scope.entity.id, session?.email ?? null);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  const args = {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_lines: lines.map((line) => ({ variantId: line.variantId, qty: Math.round(line.qty) })),
    p_reason: reason,
    p_actor: session?.email ?? null,
  };
  let dateIgnored = false;
  let { data, error } = occurredAt
    ? await db.rpc("post_writeoff", { ...args, p_occurred_at: occurredAt })
    : await db.rpc("post_writeoff", args);

  // База без миграции 202609040003 знает только пятиаргументную функцию. Списание
  // важнее даты: проводим сегодняшним числом и говорим об этом в ответе, а не
  // отказываем человеку в работе.
  if (error && occurredAt && isMissingFunction(error)) {
    ({ data, error } = await db.rpc("post_writeoff", args));
    dateIgnored = !error;
  }

  if (error) await releaseDocKey(db, docKey);
  if (error) {
    const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
    if (shortage) return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    if (error.message.includes("reason required")) return fail("Укажите причину", 400);
    if (error.message.includes("date in the future")) return fail("Дата списания в будущем", 400);
    if (error.message.includes("quantity must be positive")) return fail("Количество должно быть больше нуля", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  // Документ пишется ПОСЛЕ проводки и её не отменяет: движения уже в регистре,
  // и отказ из-за незаписанной карточки соврал бы про неудачу там, где операция
  // прошла. Без номера операция просто останется безымянной.
  const doc = await recordStockDoc(db, {
    kind: "writeoff",
    legalEntityId: scope.entity.id,
    warehouseId: body.warehouseId, cabinetId: null, targetWarehouseId: null,
    occurredAt: dateIgnored ? null : occurredAt,
    note: reason,
    result: data,
    actor: session?.email ?? null,
  });

  const result = (data ?? {}) as Record<string, unknown>;
  const warehouse = await db.from("warehouses").select("name").eq("id", body.warehouseId).maybeSingle();
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "writeoff_created",
    refType: "stock_doc",
    refId: doc?.id ?? null,
    number: doc?.number ?? null,
    warehouseId: body.warehouseId,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: {
      warehouseName: warehouse.data?.name ? String(warehouse.data.name) : null,
      reason,
      qty: result.qty ?? null,
      amount: result.amount ?? null,
      date: dateIgnored || !occurredAt ? null : occurredAt.slice(0, 10),
    },
  });

  const payload = {
    ...result,
    ...(doc ? { docNumber: doc.number, docId: doc.id } : {}),
    ...(dateIgnored ? { dateIgnored: true } : {}),
  };
  await settleDocKey(db, docKey, payload);
  return NextResponse.json({ data: payload, error: null }, { status: 201 });
}
