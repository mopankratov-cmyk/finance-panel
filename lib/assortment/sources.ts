import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseAccessStatus, type AssortmentDirection } from "./constants";
import { effectiveAccessStatus, sortSources, type AssortmentSource } from "./coverage";
import { isMissingColumnError } from "./errors";

export type LoadSourcesResult =
  | { ok: true; sources: AssortmentSource[] }
  | { ok: false; reason: "migration_missing" | "not_configured" | "error"; message: string };

const MIGRATION = "202610010005_assortment_development_schema.sql";

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return ["42P01", "PGRST205"].includes(error.code ?? "")
    || (/assortment_sources/.test(error.message ?? "") && /does not exist|could not find/i.test(error.message ?? ""));
}

function toSource(row: Record<string, unknown>): AssortmentSource {
  const categories = Array.isArray(row.categories) ? row.categories : [];
  return {
    sourceId: String(row.source_id),
    name: String(row.name ?? ""),
    group: typeof row.source_group === "string" ? row.source_group : null,
    categories: categories.filter((c): c is AssortmentDirection => c === "jackets" || c === "bags"),
    region: typeof row.region === "string" ? row.region : null,
    priority: typeof row.priority === "string" ? row.priority : null,
    adapterType: typeof row.adapter_type === "string" ? row.adapter_type : null,
    accessStatus: parseAccessStatus(row.access_status),
    accessNote: typeof row.access_note === "string" ? row.access_note : null,
    lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
  };
}

export async function loadAssortmentSources(direction: AssortmentDirection | null): Promise<LoadSourcesResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, reason: "not_configured", message: "Supabase не настроен" };
  const run = (columns: string) => {
    const query = db.from("assortment_sources").select(columns);
    return direction ? query.contains("categories", [direction]) : query;
  };
  const base = "source_id,name,source_group,categories,region,priority,adapter_type,access_status,access_note,last_success_at";
  let { data, error } = await run(`${base},last_attempt_at,last_error`);
  // Колонки пульса — из миграции 202610020002; без неё показываем паспорт без них.
  if (error && isMissingColumnError(error)) ({ data, error } = await run(base));
  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, reason: "migration_missing", message: `Таблицы модуля ещё не созданы: нужно применить миграцию ${MIGRATION}.` };
    }
    return { ok: false, reason: "error", message: error.message };
  }
  const now = Date.now();
  const sources = (data ?? []).map((row) => {
    const declared = toSource(row as unknown as Record<string, unknown>);
    const shown = effectiveAccessStatus(declared, now);
    // Показываем статус по факту работы сборщика; запись паспорта — рядом, если отличается.
    return shown === declared.accessStatus ? declared : { ...declared, accessStatus: shown, declaredAccessStatus: declared.accessStatus };
  });
  return { ok: true, sources: sortSources(sources) };
}
