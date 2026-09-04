import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { recordWarehouseEvent, type EventChange } from "@/lib/warehouse/events";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import { recordStockDoc } from "@/lib/warehouse/stockDocs";
import { variantLabel } from "@/lib/warehouse/variantLabel";

export const dynamic = "force-dynamic";

export interface ReceiptCorrectionLineInput {
  id: number;
  receivedQty?: number | null;
  defectQty?: number | null;
  /** Правится только у строк, которые ещё ждут пересчёта. */
  expectedQty?: number | null;
}

/** Итог коррекции: то, что вернула correct_receipt_batch, плюс документ и число
 *  поправленных ожидаемых строк. */
export interface ReceiptCorrectionResult {
  /** Идентификатор движений-дельт в регистре; null, если проведённых строк не трогали. */
  correctionId: string | null;
  lines: number;
  postedLines: number;
  deltaQty: number;
  deltaDefect: number;
  deltaAmount: number;
  skipped: number;
  /** Строки «ожидается», у которых поправлено ожидаемое количество. */
  expectedLines: number;
  docId?: string;
  docNumber?: string;
}

interface DbLine {
  id: number;
  cabinet_id: string;
  product_id: string | null;
  variant_id: string | null;
  article: string | null;
  status: "expected" | "received";
  expected_qty: number;
  received_qty: number | null;
  defect_qty: number | null;
  posted_at: string | null;
  warehouse_id: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const migrationHint = "Примените миграции 202609040002_warehouse_flow.sql и 202609040003_warehouse_flow_functions.sql";

const intOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

/**
 * Коррекция прихода администратором или менеджером (п. 1 ТЗ).
 *
 * Регистр append-only, поэтому «поправить приход» значит записать разницу:
 * это делает correct_receipt_batch — дельты по принятому и браку с
 * себестоимостью той же партии. Строки, которые ещё не пересчитаны, факта не
 * имеют, у них правится только ожидаемое количество — прямо здесь.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  // Оператор фулфилмента пересчитывает, но не правит: правка — это спор с его
  // же пересчётом, и вести его должен тот, кто отвечает за товар.
  if (!canManageStock(session?.role)) return fail(OPERATOR_FORBIDDEN, 403);

  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; batchId?: string; reason?: string; docKey?: string; lines?: ReceiptCorrectionLineInput[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const batchId = body.batchId;
  if (!batchId) return fail("Не указана партия приёмки", 400);
  const reason = String(body.reason ?? "").trim();
  if (!reason) return fail("Укажите причину", 400);
  const inputs = (body.lines ?? []).filter((line) => line && Number.isFinite(Number(line.id)));
  if (inputs.length === 0) return fail("Нечего править: ни одной строки", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  if (ownCabinets.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);

  const existing = await db
    .from("purchase_receipts")
    .select("id, cabinet_id, product_id, variant_id, article, status, expected_qty, received_qty, defect_qty, posted_at, warehouse_id")
    .eq("batch_id", batchId);
  if (existing.error) return fail(existing.error.message, 500);
  const known = new Map(((existing.data ?? []) as DbLine[]).map((row) => [Number(row.id), row]));
  if (known.size === 0) return fail("Партия не найдена", 404);
  for (const row of known.values()) {
    if (!ownCabinets.includes(String(row.cabinet_id))) return fail("Партия принадлежит другому юрлицу", 403);
  }

  // Делим правки на два русла: ожидаемое у непересчитанных — прямой update,
  // принятое и брак у пересчитанных — через функцию с дельтами в регистр.
  const expectedUpdates: { id: number; before: number; after: number }[] = [];
  const rpcLines: { id: number; receivedQty: number | null; defectQty: number | null }[] = [];
  let skipped = 0;
  for (const input of inputs) {
    const row = known.get(Number(input.id));
    if (!row) return fail("В партии нет такой позиции", 400);
    const expectedQty = intOrNull(input.expectedQty);
    const receivedQty = intOrNull(input.receivedQty);
    const defectQty = intOrNull(input.defectQty);

    if (row.status === "expected") {
      // Принятого у такой строки ещё нет — править его нечем; функция такие
      // строки тоже пропускает, здесь просто считаем их.
      if (receivedQty !== null || defectQty !== null) skipped += 1;
      if (expectedQty === null) continue;
      if (expectedQty <= 0) return fail("Ожидаемое количество должно быть больше нуля", 400);
      if (expectedQty !== Number(row.expected_qty)) expectedUpdates.push({ id: row.id, before: Number(row.expected_qty), after: expectedQty });
      continue;
    }

    if (receivedQty === null && defectQty === null) continue;
    const nextReceived = receivedQty ?? Number(row.received_qty ?? 0);
    const nextDefect = defectQty ?? Number(row.defect_qty ?? 0);
    if (nextReceived < 0 || nextDefect < 0) return fail("Некорректное количество", 400);
    if (nextDefect > nextReceived) return fail("Брака больше, чем принято", 400);
    if (nextReceived === Number(row.received_qty ?? 0) && nextDefect === Number(row.defect_qty ?? 0)) continue;
    rpcLines.push({ id: row.id, receivedQty: nextReceived, defectQty: nextDefect });
  }

  if (expectedUpdates.length === 0 && rpcLines.length === 0) {
    return fail("Ничего не изменилось — количества совпадают с текущими", 400);
  }

  // Ключ идемпотентности: второй клик не должен давать вторую порцию дельт.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "receipt_correction", scope.entity.id, session?.email ?? null);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  const now = new Date().toISOString();
  for (const line of expectedUpdates) {
    const { error } = await db
      .from("purchase_receipts")
      .update({ expected_qty: line.after, updated_at: now })
      .eq("id", line.id)
      .eq("status", "expected");
    if (error) {
      await releaseDocKey(db, docKey);
      return fail(error.message, 500);
    }
  }

  let result: ReceiptCorrectionResult = {
    correctionId: null, lines: 0, postedLines: 0, deltaQty: 0, deltaDefect: 0, deltaAmount: 0,
    skipped, expectedLines: expectedUpdates.length,
  };
  if (rpcLines.length > 0) {
    const { data, error } = await db.rpc("correct_receipt_batch", {
      p_batch_id: batchId,
      p_lines: rpcLines,
      p_reason: reason,
      p_actor: session?.email ?? null,
    });
    if (error) {
      await releaseDocKey(db, docKey);
      const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
      if (shortage) return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
      if (error.message.includes("defect exceeds received")) return fail("Брака больше, чем принято", 400);
      if (error.message.includes("reason required")) return fail("Укажите причину", 400);
      if (error.message.includes("is not in batch")) return fail("В партии нет такой позиции", 400);
      if (error.message.includes("quantity must be non-negative")) return fail("Некорректное количество", 400);
      if (error.message.includes("has no variant, warehouse or batch")) {
        return fail("Проведённая строка без размера или склада — поправить её нельзя, только сторнировать партию", 409);
      }
      if (missingMigration(error.code) || /does not exist|schema cache/i.test(error.message)) return fail(migrationHint, 503);
      return fail(error.message, 500);
    }
    const raw = (data ?? {}) as Record<string, unknown>;
    result = {
      ...result,
      correctionId: typeof raw.correctionId === "string" && raw.correctionId ? raw.correctionId : null,
      lines: Number(raw.lines ?? 0),
      postedLines: Number(raw.postedLines ?? 0),
      deltaQty: Number(raw.deltaQty ?? 0),
      deltaDefect: Number(raw.deltaDefect ?? 0),
      deltaAmount: Number(raw.deltaAmount ?? 0),
      skipped: skipped + Number(raw.skipped ?? 0),
    };
  }

  // Документ и хроника — ПОСЛЕ проводки и её не отменяют: дельты уже в регистре.
  // Склад коррекции — склад проведённых строк: у партии он один.
  const warehouseId = [...known.values()].find((row) => row.posted_at && row.warehouse_id)?.warehouse_id ?? null;
  if (result.correctionId) {
    const doc = await recordStockDoc(db, {
      kind: "adjustment",
      legalEntityId: scope.entity.id,
      warehouseId,
      cabinetId: null,
      targetWarehouseId: null,
      note: reason,
      result: { ...result },
      actor: session?.email ?? null,
    });
    if (doc) result = { ...result, docId: doc.id, docNumber: doc.number };
  }

  // Журнал правок (п. 6 ТЗ): по каждой строке — что было и что стало.
  const changedIds = new Set([...expectedUpdates.map((line) => line.id), ...rpcLines.map((line) => line.id)]);
  const variantIds = [...new Set([...changedIds].map((id) => known.get(id)?.variant_id).filter(Boolean).map(String))];
  const sizes = new Map<string, string>();
  if (variantIds.length > 0) {
    const variants = await db.from("product_variants").select("id, size_label").in("id", variantIds);
    for (const variant of variants.data ?? []) sizes.set(String(variant.id), String(variant.size_label ?? ""));
  }
  const labelOf = (row: DbLine) => variantLabel(String(row.article ?? ""), row.variant_id ? sizes.get(String(row.variant_id)) : "");
  const changes: EventChange[] = [];
  for (const line of expectedUpdates) {
    const row = known.get(line.id);
    if (row) changes.push({ line: labelOf(row), field: "expected", before: line.before, after: line.after });
  }
  for (const line of rpcLines) {
    const row = known.get(line.id);
    if (!row) continue;
    const beforeReceived = Number(row.received_qty ?? 0);
    const beforeDefect = Number(row.defect_qty ?? 0);
    if (line.receivedQty !== null && line.receivedQty !== beforeReceived) {
      changes.push({ line: labelOf(row), field: "received", before: beforeReceived, after: line.receivedQty });
    }
    if (line.defectQty !== null && line.defectQty !== beforeDefect) {
      changes.push({ line: labelOf(row), field: "defect", before: beforeDefect, after: line.defectQty });
    }
  }

  const header = await db.from("stock_receipt_batches").select("number").eq("batch_id", batchId).maybeSingle();
  await recordWarehouseEvent(db, {
    legalEntityId: scope.entity.id,
    kind: "receipt_corrected",
    refType: "receipt_batch",
    refId: batchId,
    number: header.data?.number ? String(header.data.number) : null,
    warehouseId,
    actor: session?.email ?? null,
    actorRole: session?.role ?? null,
    payload: { reason, deltaQty: result.deltaQty, deltaDefect: result.deltaDefect, deltaAmount: result.deltaAmount, docNumber: result.docNumber ?? null },
    changes,
  });

  await settleDocKey(db, docKey, result);
  return NextResponse.json({ data: result, error: null });
}
