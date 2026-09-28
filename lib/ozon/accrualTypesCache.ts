import type { SupabaseClient } from "@supabase/supabase-js";
import type { OzonAccrualType } from "@/lib/ozon/api";

export interface OzonAccrualTypeRow {
  type_id: number;
  name: string;
  description: string;
  updated_at: string;
}

/** Кабинето-независимый справочник — только для подписи строк детализации, не для разбора по разделам (см. Task 3). */
export function parseAccrualTypeRows(types: OzonAccrualType[], now: Date): OzonAccrualTypeRow[] {
  const updatedAt = now.toISOString();
  return types
    .filter((t) => Number.isFinite(t.id))
    .map((t) => ({
      type_id: t.id,
      name: String(t.name ?? ""),
      description: String(t.description ?? ""),
      updated_at: updatedAt,
    }));
}

/**
 * `name` — внутренний идентификатор Ozon (например, "SaleCommission"),
 * `description` — человекочитаемое русское название (например, «Комиссия за
 * продажу»). Отчёт на русском показывает description, если он есть —
 * подпись строки, а не идентификатор поля (finding I5 в финальном ревью).
 */
export function labelFromAccrualType(row: { name: string; description: string }): string {
  return row.description || row.name;
}

/** type_id → подпись строки детализации отчёта (lib/ozon/opiuOzonReport.ts). */
export async function readCachedAccrualTypeNames(db: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id, name, description");
  const names = new Map<number, string>();
  for (const row of data ?? []) {
    names.set(Number(row.type_id), labelFromAccrualType({ name: String(row.name), description: String(row.description ?? "") }));
  }
  return names;
}

/** Все type_id, когда-либо закэшированные — для баннера новых категорий (спека §6), отдельно от readCachedAccrualTypeNames чтобы не тянуть name, когда он не нужен. */
export async function readCachedAccrualTypeIds(db: SupabaseClient): Promise<Set<number>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id");
  return new Set((data ?? []).map((row) => Number(row.type_id)));
}
