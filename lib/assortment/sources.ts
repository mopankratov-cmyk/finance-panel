import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseAccessStatus, type AssortmentDirection } from "./constants";
import { effectiveAccessStatus, sortSources, type AssortmentSource } from "./coverage";
import { isMissingColumnError } from "./errors";
import { socialConfig } from "./socialReels";
import { STAGE6_AWAITING_NOTE, STAGE6_AWAITING_OWNER, STAGE6_CONNECTED, STAGE6_SWITCHED_OFF_NOTE } from "./stage6Sources";

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

/**
 * Последний прогон крона подключённых источников Этапа 6, который действительно собирал (по журналу sync_log): ok или partial и с
 * сделанной работой (rows_affected > 0). Выключенный крон (ASSORTMENT_SOCIAL=off пишет «ok» с нулём) и прогон, которому общий потолок
 * движка не дал ни одного запроса, — не пульс. Сбой чтения — пусто: статус тогда «частично», а не ошибка всего экрана.
 */
async function stage6Pulses(db: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(Object.entries(STAGE6_CONNECTED).map(async ([sourceId, connected]) => {
    const { data, error } = await db.from("sync_log").select("started_at").eq("job", connected.job).in("status", ["ok", "partial"]).gt("rows_affected", 0)
      .order("started_at", { ascending: false }).limit(1);
    const at = !error ? (data?.[0] as { started_at?: string } | undefined)?.started_at : undefined;
    if (at) out.set(sourceId, at);
  }));
  return out;
}

export interface LoadSourcesDeps {
  /** База (по умолчанию — служебный клиент). */
  db?: SupabaseClient | null;
  now?: number;
  /** Включён ли сбор рилсов (по умолчанию — ASSORTMENT_SOCIAL из окружения). */
  socialEnabled?: boolean;
}

export async function loadAssortmentSources(direction: AssortmentDirection | null, deps: LoadSourcesDeps = {}): Promise<LoadSourcesResult> {
  const db = deps.db === undefined ? getSupabaseAdmin() : deps.db;
  if (!db) return { ok: false, reason: "not_configured", message: "Supabase не настроен" };
  const run = (columns: string) => {
    const query = db.from("assortment_sources").select(columns);
    return direction ? query.contains("categories", [direction]) : query;
  };
  const base = "source_id,name,source_group,categories,region,priority,adapter_type,access_status,access_note,last_success_at";
  // Пульс подключённых источников Этапа 6 — из журнала их крона; читаем вместе с паспортом, а не после него (лишний круг к базе).
  const pulsesRead = stage6Pulses(db).catch(() => new Map<string, string>());
  let { data, error } = await run(`${base},last_attempt_at,last_error`);
  // Колонки пульса — из миграции 202610020002; без неё показываем паспорт без них.
  if (error && isMissingColumnError(error)) ({ data, error } = await run(base));
  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, reason: "migration_missing", message: `Таблицы модуля ещё не созданы: нужно применить миграцию ${MIGRATION}.` };
    }
    return { ok: false, reason: "error", message: error.message };
  }
  const now = deps.now ?? Date.now();
  const pulses = await pulsesRead;
  const socialOn = deps.socialEnabled ?? socialConfig().enabled;
  const sources = (data ?? []).map((row): AssortmentSource => {
    const parsed = toSource(row as unknown as Record<string, unknown>);
    // Этап 6 подписан в коде, без UPDATE паспорта: запись паспорта этапа 0 («Кандидат; доступ не проверен», «ключ не тестировался») —
    // итог исследования, а не факт. Отключённый или недоступный по паспорту — как записано.
    const pinned = parsed.accessStatus === "disabled" || parsed.accessStatus === "unavailable";
    if (STAGE6_AWAITING_OWNER.has(parsed.sourceId) && !pinned) return { ...parsed, accessStatus: "not_connected", accessNote: STAGE6_AWAITING_NOTE };
    const connected = STAGE6_CONNECTED[parsed.sourceId];
    if (connected && !pinned) {
      // Подключённый источник Этапа 6 (рилсы) пульс пишет в журнал своего крона, а не в паспорт; выключен настройкой — «Отключён».
      if (!socialOn) return { ...parsed, accessStatus: "disabled", accessNote: STAGE6_SWITCHED_OFF_NOTE };
      const pulsed = { ...parsed, accessNote: connected.note, lastSuccessAt: parsed.lastSuccessAt ?? pulses.get(parsed.sourceId) ?? null };
      return { ...pulsed, accessStatus: effectiveAccessStatus(pulsed, now) };
    }
    const shown = effectiveAccessStatus(parsed, now);
    // Показываем статус по факту работы сборщика; запись паспорта — рядом, если отличается.
    if (shown === parsed.accessStatus) return { ...parsed, accessStatus: shown };
    return { ...parsed, accessStatus: shown, declaredAccessStatus: parsed.accessStatus };
  });
  return { ok: true, sources: sortSources(sources) };
}
