import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { CATALOG_SEEN_DAYS } from "./catalog";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { buildFormsReport, type FormModel, type FormsReport } from "./forms";
import { baseHeadsFilters } from "./headsBase";
import { modelKey } from "./modelKey";

/**
 * Формы каталога по моделям. Читаем те же модели, что показывает каталог:
 * вид голов (по одной карточке на модель; миграция 202610050002), без него —
 * строки таблицы, склеенные по ключу модели здесь же. Скрытые «Не интересно» и
 * давно не виденные (30 дней) модели не считаем — как в каталоге.
 */

interface HeadRow {
  source_id: string;
  source_item_id: string;
  title: string | null;
}

async function sourceNames(db: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await db.from("assortment_sources").select("source_id,name");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [String((row as { source_id: string }).source_id), String((row as { name: string | null }).name ?? (row as { source_id: string }).source_id)]));
}

function unavailable(error: { code?: string | null; message?: string | null }): boolean {
  return isMissingAssortmentSchema(new Error(error.message ?? "")) || isMissingColumnError(error) || error.code === "PGRST205" || error.code === "42P01";
}

/** Модели раздела для разбора по формам и откуда они прочитаны: viaHeads — из вида голов (по нему работает фильтр «Форма» в каталоге). */
export async function loadFormModelsInfo(db: SupabaseClient, direction: AssortmentDirection, nowMs = Date.now()): Promise<{ models: FormModel[]; viaHeads: boolean }> {
  const seenSince = new Date(nowMs - CATALOG_SEEN_DAYS * 24 * 3600 * 1000).toISOString();
  const names = await sourceNames(db);
  const name = (id: string) => names.get(id) ?? id;

  // Вид голов: одна строка на модель. Выборка режется на тысяче строк — листаем. Набор моделей — общий с каталогом (headsBase).
  try {
    const heads = await loadAllSupabasePages<HeadRow>((from, to) => baseHeadsFilters(db.from("assortment_catalog_heads").select("source_id,source_item_id,title"), direction, nowMs)
      .order("source_id", { ascending: true })
      .order("source_item_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: HeadRow[] | null; error: { message: string } | null }>, { label: "Формы каталога", pageSize: 1000 });
    return { models: heads.map((r) => ({ sourceId: r.source_id, sourceName: name(r.source_id), title: r.title ?? "" })), viaHeads: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!unavailable({ message })) throw error;
  }

  // Вида ещё нет: строки таблицы, склеенные по ключу модели.
  const rows = await loadAllSupabasePages<HeadRow & { model_key?: string | null }>((from, to) => db.from("assortment_source_items")
    .select("source_id,source_item_id,title")
    .eq("direction", direction)
    .gte("last_seen_at", seenSince)
    .order("source_id", { ascending: true })
    .order("source_item_id", { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: Array<HeadRow & { model_key?: string | null }> | null; error: { message: string } | null }>, { label: "Формы каталога", pageSize: 1000 });
  const seen = new Set<string>();
  const models: FormModel[] = [];
  for (const r of rows) {
    const key = modelKey({ sourceId: r.source_id, sourceItemId: r.source_item_id, title: r.title });
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ sourceId: r.source_id, sourceName: name(r.source_id), title: r.title ?? "" });
  }
  return { models, viaHeads: false };
}

export async function loadFormModels(db: SupabaseClient, direction: AssortmentDirection, nowMs = Date.now()): Promise<FormModel[]> {
  return (await loadFormModelsInfo(db, direction, nowMs)).models;
}

export async function loadFormsReport(db: SupabaseClient, direction: AssortmentDirection, nowMs = Date.now()): Promise<FormsReport> {
  const { models, viaHeads } = await loadFormModelsInfo(db, direction, nowMs);
  return { ...buildFormsReport(direction, models), viaHeads };
}
