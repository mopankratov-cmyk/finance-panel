// Документ вокруг проводки.
//
// Функции проведения остались нетронутыми: они по-прежнему рассыпают операцию в
// строки регистра и возвращают идентификатор. Документ — это то, что помнит про
// эту операцию всё остальное: номер, дату, автора, итог и ссылку на движения.
//
// Так сделано намеренно. Переписывать четыре большие SQL-функции ради номера
// значило бы рисковать проверенной механикой ради надстройки; а надстройка,
// живущая рядом, даёт и журнал, и человеческий номер, и сторно — сразу всем
// видам операций, включая те, что появятся позже.

import type { SupabaseClient } from "@supabase/supabase-js";

export type StockDocKind = "shipment" | "transfer" | "writeoff" | "return" | "receipt";

/** Ключ, под которым проводка записала движения, — у каждой функции свой. */
const MOVEMENT_ID_FIELDS: Record<StockDocKind, string> = {
  shipment: "shipmentId",
  transfer: "transferId",
  writeoff: "writeoffId",
  return: "returnId",
  receipt: "batchId",
};

export function movementDocIdOf(kind: StockDocKind, result: unknown): string | null {
  const value = (result as Record<string, unknown> | null)?.[MOVEMENT_ID_FIELDS[kind]];
  return typeof value === "string" && value ? value : null;
}

export interface RecordDocInput {
  kind: StockDocKind;
  legalEntityId: string;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  cabinetId?: string | null;
  occurredAt?: string | null;
  note?: string | null;
  result: unknown;
  actor: string | null;
}

/**
 * Записать документ по уже проведённой операции.
 *
 * Ошибка здесь НЕ роняет ответ: движения уже в регистре, и отказать пользователю
 * из-за того, что не записалась карточка документа, значило бы соврать про
 * неудачу там, где операция прошла. Вернём null и оставим операцию без номера.
 */
export async function recordStockDoc(
  db: SupabaseClient,
  input: RecordDocInput,
): Promise<{ id: string; number: string } | null> {
  try {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const numberResult = await db.rpc("next_stock_doc_number", { p_kind: input.kind, p_at: occurredAt });
    if (numberResult.error || !numberResult.data) return null;

    const { data, error } = await db
      .from("stock_docs")
      .insert({
        number: String(numberResult.data),
        kind: input.kind,
        status: "posted",
        legal_entity_id: input.legalEntityId,
        warehouse_id: input.warehouseId ?? null,
        target_warehouse_id: input.targetWarehouseId ?? null,
        cabinet_id: input.cabinetId ?? null,
        occurred_at: occurredAt,
        note: input.note ?? null,
        movement_doc_id: movementDocIdOf(input.kind, input.result),
        result: input.result ?? null,
        created_by: input.actor,
      })
      .select("id, number")
      .single();
    if (error || !data) return null;
    return { id: String(data.id), number: String(data.number) };
  } catch {
    return null;
  }
}
