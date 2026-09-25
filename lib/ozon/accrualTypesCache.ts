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

/** type_id → имя, для подписи строк детализации отчёта (lib/ozon/opiuOzonReport.ts). */
export async function readCachedAccrualTypeNames(db: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id, name");
  const names = new Map<number, string>();
  for (const row of data ?? []) {
    names.set(Number(row.type_id), String(row.name));
  }
  return names;
}

/** Все type_id, когда-либо закэшированные — для баннера новых категорий (спека §6), отдельно от readCachedAccrualTypeNames чтобы не тянуть name, когда он не нужен. */
export async function readCachedAccrualTypeIds(db: SupabaseClient): Promise<Set<number>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id");
  return new Set((data ?? []).map((row) => Number(row.type_id)));
}
