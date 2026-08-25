import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";
import { recordStockDoc } from "@/lib/warehouse/stockDocs";

export const dynamic = "force-dynamic";

export interface ShipmentLineInput {
  variantId: string;
  cabinetId: string;
  qty: number;
}

export interface ShipmentResult {
  shipmentId: string;
  lines: number;
  qty: number;
  amount: number;
  /** По накладной на кабинет: машина на склад Wildberries и машина на Ozon — разные. */
  docs?: { number: string; cabinetId: string; qty: number }[];
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230005_shipments.sql";

/** Отгрузка со склада на кабинеты: одна операция, строка на пару «SKU + кабинет». */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; docKey?: string; warehouseId?: string; note?: string; lines?: ShipmentLineInput[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад, с которого отгружаем", 400);

  const lines = (body.lines ?? []).filter((line) => Number(line.qty) > 0);
  if (lines.length === 0) return fail("Укажите хотя бы одну позицию с количеством", 400);

  // Кабинет отгрузки должен быть связан с юрлицом: свой или агентский. Иначе товар
  // ушёл бы туда, где юрлицо не торгует, и это почти наверняка опечатка в выборе.
  const allowedCabinets = new Set(scope.entity.cabinets.map((link) => link.cabinetId));
  for (const line of lines) {
    if (!line.cabinetId) return fail("У каждой строки должен быть кабинет", 400);
    if (!allowedCabinets.has(line.cabinetId)) {
      return fail(`Кабинет не связан с юрлицом «${scope.entity.name}»`, 400);
    }
    if (!line.variantId) return fail("В строке не указан товар", 400);
  }

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Ключ идемпотентности: второй клик по кнопке не должен давать второй документ.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "shipment", scope.entity.id, session?.email ?? null);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  const { data, error } = await db.rpc("post_shipment", {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_lines: lines.map((line) => ({
      variantId: line.variantId,
      cabinetId: line.cabinetId,
      qty: Math.round(line.qty),
    })),
    p_note: body.note?.trim() || null,
    p_actor: session?.email ?? null,
  });

  if (error) await releaseDocKey(db, docKey);
  if (error) {
    const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
    if (shortage) {
      return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    }
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    if (error.message.includes("shipment has no lines")) return fail("Укажите хотя бы одну позицию", 400);
    if (error.message.includes("quantity must be positive")) return fail("Количество должно быть больше нуля", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  // Документы пишутся ПОСЛЕ проводки и её не отменяют: движения уже в регистре,
  // и отказ из-за незаписанной карточки соврал бы про неудачу там, где операция
  // прошла. Без номера операция просто останется безымянной.
  //
  // Проводка одна — накладных столько, сколько кабинетов: товар уезжает разными
  // машинами в разные места, и общий лист на три кабинета водитель предъявить
  // не может. Атомарность при этом сохраняется: остаток списан одним вызовом,
  // и частично уехавшей отгрузки не бывает.
  const movementDocId = (data as Record<string, unknown> | null)?.shipmentId;
  const moves = typeof movementDocId === "string" && movementDocId
    ? await db.from("stock_moves").select("cabinet_id, qty, amount").eq("doc_id", movementDocId)
    : { data: [], error: null };
  const byCabinet = new Map<string, { qty: number; amount: number; lines: number }>();
  for (const row of ((moves.data ?? []) as { cabinet_id: string | null; qty: number; amount: number }[])) {
    const key = row.cabinet_id ? String(row.cabinet_id) : "";
    const bucket = byCabinet.get(key) ?? { qty: 0, amount: 0, lines: 0 };
    bucket.qty += Math.abs(Number(row.qty));
    bucket.amount += Math.abs(Number(row.amount));
    bucket.lines += 1;
    byCabinet.set(key, bucket);
  }

  const docs: { number: string; cabinetId: string; qty: number }[] = [];
  for (const [cabinetId, totals] of byCabinet) {
    const doc = await recordStockDoc(db, {
      kind: "shipment",
      legalEntityId: scope.entity.id,
      warehouseId: body.warehouseId, cabinetId: cabinetId || null, targetWarehouseId: null,
      note: body.note?.trim() || null,
      result: { shipmentId: movementDocId, cabinetId: cabinetId || null, ...totals },
      actor: session?.email ?? null,
    });
    if (doc) docs.push({ number: doc.number, cabinetId, qty: totals.qty });
  }

  const payload = { ...(data as Record<string, unknown>), docs };
  await settleDocKey(db, docKey, payload);
  return NextResponse.json({ data: payload as ShipmentResult, error: null }, { status: 201 });
}
