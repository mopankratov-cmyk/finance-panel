// Один ключ на нажатие кнопки.
//
// Регистр движений append-only: проведённое обратно не отыграешь. При этом
// второй клик, ретрай сети или обновление вкладки на медленном ответе давали
// вторую отгрузку — и отличить её от настоящей второй отгрузки задним числом
// невозможно.
//
// Слой живёт снаружи функций проведения: клиент присылает ключ, первый запрос
// его занимает, второй получает ответ первого вместо новой проводки. Так это
// работает для любой операции, не требуя переписывать ни одну SQL-функцию.

import type { SupabaseClient } from "@supabase/supabase-js";

export type DocKind = "shipment" | "writeoff" | "transfer" | "return" | "fbs_sale";

export type ClaimResult =
  | { state: "claimed" }
  /** Документ уже проведён — отдаём тот же ответ, что и в первый раз. */
  | { state: "done"; result: unknown }
  /** Тот же ключ прямо сейчас проводится другим запросом. */
  | { state: "busy" }
  /** Ключа нет — идемпотентность выключена, работаем как раньше. */
  | { state: "off" };

/** Ключ занимается ДО вызова проводки. */
export async function claimDocKey(
  db: SupabaseClient,
  key: string | null | undefined,
  kind: DocKind,
  legalEntityId: string,
  actor: string | null,
): Promise<ClaimResult> {
  if (!key) return { state: "off" };
  const { data, error } = await db.rpc("claim_stock_doc_key", {
    p_key: key,
    p_kind: kind,
    p_legal_entity_id: legalEntityId,
    p_actor: actor,
  });
  // Миграция ещё не применена — не мешаем работать, просто без защиты.
  if (error) return { state: "off" };
  const row = (data ?? {}) as { claimed?: boolean; result?: unknown };
  if (row.claimed) return { state: "claimed" };
  return row.result != null ? { state: "done", result: row.result } : { state: "busy" };
}

/** Ключ закрывается ответом: повтор получит его, а не новую проводку. */
export async function settleDocKey(
  db: SupabaseClient,
  key: string | null | undefined,
  result: unknown,
): Promise<void> {
  if (!key) return;
  await db.rpc("settle_stock_doc_key", { p_key: key, p_result: result });
}

/** Проводка не удалась — ключ освобождаем, иначе повтор после исправления
 *  ошибки будет вечно упираться в занятый ключ. */
export async function releaseDocKey(db: SupabaseClient, key: string | null | undefined): Promise<void> {
  if (!key) return;
  await db.rpc("release_stock_doc_key", { p_key: key });
}

export const BUSY_MESSAGE = "Документ уже проводится — подождите ответа, не нажимайте второй раз";
