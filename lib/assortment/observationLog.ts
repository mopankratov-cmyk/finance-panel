import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import { moscowToday } from "@/lib/sync/moscowDay";

/**
 * Слой наблюдений (движок тенденций, этап 1). Пишет историю, которую каталог
 * не хранит: журнал прогонов (assortment_run) и снимки присутствия товара по
 * дням (assortment_item_snapshot). Миграция 202610050001.
 *
 * Запись вспомогательная: если таблиц ещё нет (миграцию не применили) или
 * запись сорвалась — обход НЕ должен падать. Поэтому всё обёрнуто, а
 * отсутствие таблиц распознаётся как ожидаемое состояние, а не авария.
 */

const SNAPSHOT_BATCH = 500;
const MAX_IMAGE_URLS = 4;

/** Насколько полно увидели раздел — определяет доверие к «появилось/пропало». */
export type RunCoverage = "full" | "window" | "partial";

export interface RunInput {
  sourceId: string;
  /** Раздел прогона; null — источник обойдён целиком (снимок несёт свой раздел). */
  direction: AssortmentDirection | null;
  coverage: RunCoverage;
  seen: number;
  added: number;
  /** Начало обхода раздела (ISO); по умолчанию — момент записи. */
  startedAt?: string;
  snapshotId?: string | null;
  error?: string | null;
}

export interface SnapshotItem {
  sourceItemId: string;
  direction: AssortmentDirection | null;
  title?: string | null;
  brand?: string | null;
  images?: string[] | null;
  badges?: string[] | null;
}

/** Только https-ссылки, без дублей, до 4 — как в каталоге. */
function cleanImages(images: string[] | null | undefined): string[] | null {
  const urls = [...new Set((images ?? []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)))].slice(0, MAX_IMAGE_URLS);
  return urls.length ? urls : null;
}

/** Строки снимка для вставки — чистая функция (тестируется без базы). */
export function snapshotRows(
  runId: string,
  sourceId: string,
  observedOn: string,
  items: SnapshotItem[],
): Array<Record<string, unknown>> {
  // Один товар за прогон попадает в снимок один раз: повтор в выдаче не плодит
  // строки. Берём первое вхождение (обычно оно полнее — с фото и названием).
  const byItem = new Map<string, SnapshotItem>();
  for (const item of items) if (!byItem.has(item.sourceItemId)) byItem.set(item.sourceItemId, item);
  return [...byItem.values()].map((item) => ({
    run_id: runId,
    source_id: sourceId,
    source_item_id: item.sourceItemId,
    direction: item.direction,
    observed_on: observedOn,
    present: true,
    title: item.title?.trim()?.slice(0, 400) ?? null,
    brand: item.brand?.trim()?.slice(0, 120) ?? null,
    image_urls: cleanImages(item.images),
    badges: item.badges && item.badges.length ? [...new Set(item.badges)] : null,
  }));
}

/** Строка журнала прогона для вставки — чистая функция. */
export function runRow(runId: string, observedOn: string, input: RunInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    run_id: runId,
    source_id: input.sourceId,
    direction: input.direction,
    observed_on: observedOn,
    started_at: input.startedAt ?? now,
    finished_at: now,
    coverage: input.coverage,
    seen: Math.max(0, Math.trunc(input.seen)),
    added: Math.max(0, Math.trunc(input.added)),
    snapshot_id: input.snapshotId ?? null,
    error: input.error?.slice(0, 400) ?? null,
  };
}

/**
 * Записать прогон и снимок присутствия. Возвращает run_id или null, если
 * таблиц ещё нет либо запись не удалась (обход при этом продолжается).
 */
export async function recordObservation(
  db: SupabaseClient,
  input: RunInput,
  items: SnapshotItem[],
  now: Date | number = new Date(),
): Promise<string | null> {
  const runId = globalThis.crypto.randomUUID();
  const observedOn = moscowToday(now);
  try {
    const { error: runError } = await db.from("assortment_run").insert(runRow(runId, observedOn, input));
    if (runError) {
      // Таблиц ещё нет — ожидаемо до применения миграции, молчим.
      if (isMissingAssortmentSchema(runError)) return null;
      throw new Error(runError.message);
    }
    const rows = snapshotRows(runId, input.sourceId, observedOn, items);
    for (let i = 0; i < rows.length; i += SNAPSHOT_BATCH) {
      const { error } = await db
        .from("assortment_item_snapshot")
        .upsert(rows.slice(i, i + SNAPSHOT_BATCH), { onConflict: "source_id,source_item_id,run_id", ignoreDuplicates: true });
      if (error) {
        if (isMissingAssortmentSchema(error)) return runId;
        throw new Error(error.message);
      }
    }
    return runId;
  } catch {
    // Снимок — вспомогательный: его сбой не роняет обход. Пульс источника
    // (last_error) и sync_log прогон всё равно зафиксируют отдельно.
    return null;
  }
}
