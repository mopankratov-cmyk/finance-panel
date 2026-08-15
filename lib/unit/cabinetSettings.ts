// Ручные настройки юнит-экономики кабинета: ставка налога и дополнительная
// комиссия (посредник, агент). Ни то, ни другое не выводится из API площадки —
// у каждой компании свой налоговый режим, а комиссия посредника вообще живёт
// в договоре. Поэтому значения вводит владелец, а мы их только применяем.
//
// NULL ≠ 0: NULL означает «не задано» и оставляет прежнее поведение (налог из
// параметра запроса, никакой дополнительной комиссии), а ноль — осознанный выбор
// владельца. Смешивать их нельзя, иначе «налога нет» станет неотличимо от
// «настройку ещё не открывали».

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CabinetUnitSettings {
  cabinetId: string;
  /** Ставка налога, % от цены покупателя. null — не задана. */
  taxPct: number | null;
  /** Дополнительная комиссия кабинета, % от цены продавца. null — не задана. */
  extraCommissionPct: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const CABINET_UNIT_SETTINGS_TABLE = "cabinet_unit_settings";

const PCT_LIMITS = { min: 0, max: 100 } as const;

/** Отбрасывает мусор и держит процент в разумных границах. `null` — значение не задано. */
export function normalizeCabinetPct(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < PCT_LIMITS.min || parsed > PCT_LIMITS.max) return null;
  return Math.round(parsed * 100) / 100;
}

/** true — значение прислали, но оно за границами: молча обнулять такое нельзя. */
export function isRejectedCabinetPct(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return normalizeCabinetPct(value) === null;
}

interface SettingsRow {
  cabinet_id: string;
  tax_pct: number | string | null;
  extra_commission_pct: number | string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

function fromRow(row: SettingsRow): CabinetUnitSettings {
  return {
    cabinetId: String(row.cabinet_id),
    taxPct: normalizeCabinetPct(row.tax_pct),
    extraCommissionPct: normalizeCabinetPct(row.extra_commission_pct),
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

/**
 * Настройки нескольких кабинетов разом. Отсутствующей таблицы быть не должно, но
 * если миграция ещё не применена — экран обязан работать по-старому, а не падать.
 */
export async function loadCabinetUnitSettings(
  db: SupabaseClient,
  cabinetIds?: readonly string[] | null,
): Promise<Map<string, CabinetUnitSettings>> {
  const out = new Map<string, CabinetUnitSettings>();
  if (cabinetIds && cabinetIds.length === 0) return out;
  let query = db.from(CABINET_UNIT_SETTINGS_TABLE)
    .select("cabinet_id, tax_pct, extra_commission_pct, updated_at, updated_by");
  if (cabinetIds && cabinetIds.length > 0) query = query.in("cabinet_id", [...cabinetIds]);
  const { data, error } = await query;
  if (error) {
    if (isMissingSettingsTable(error)) return out;
    throw new Error(error.message);
  }
  for (const row of (data ?? []) as SettingsRow[]) {
    const settings = fromRow(row);
    out.set(settings.cabinetId, settings);
  }
  return out;
}

/** Настройки одного кабинета; null — кабинет не выбран или настройки не заданы. */
export async function loadCabinetUnitSetting(
  db: SupabaseClient,
  cabinetId: string | null,
): Promise<CabinetUnitSettings | null> {
  if (!cabinetId) return null;
  const settings = await loadCabinetUnitSettings(db, [cabinetId]);
  return settings.get(cabinetId) ?? null;
}

export async function saveCabinetUnitSettings(
  db: SupabaseClient,
  input: { cabinetId: string; taxPct: number | null; extraCommissionPct: number | null; updatedBy?: string | null },
): Promise<CabinetUnitSettings> {
  const { data, error } = await db.from(CABINET_UNIT_SETTINGS_TABLE)
    .upsert({
      cabinet_id: input.cabinetId,
      tax_pct: input.taxPct,
      extra_commission_pct: input.extraCommissionPct,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy ?? null,
    }, { onConflict: "cabinet_id" })
    .select("cabinet_id, tax_pct, extra_commission_pct, updated_at, updated_by")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Настройки кабинета не сохранились");
  return fromRow(data as SettingsRow);
}

/** Миграция ещё не применена — читаем это как «настроек нет», а не как аварию. */
export function isMissingSettingsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .*cabinet_unit_settings.* does not exist/i.test(error.message ?? "");
}

/**
 * Итоговая ставка налога: настройка кабинета важнее значения по умолчанию, но
 * явно переданный в запросе параметр важнее обеих — иначе нельзя было бы
 * посчитать «а что если» прямо на экране.
 */
export function resolveTaxPct(input: {
  requested: number | null;
  cabinet: number | null;
  fallback: number;
}): { taxPct: number; source: "request" | "cabinet" | "default" } {
  if (input.requested != null) return { taxPct: input.requested, source: "request" };
  if (input.cabinet != null) return { taxPct: input.cabinet, source: "cabinet" };
  return { taxPct: input.fallback, source: "default" };
}

/** Дополнительная комиссия: та же логика приоритетов, но по умолчанию её нет. */
export function resolveExtraCommissionPct(input: {
  requested: number | null;
  cabinet: number | null;
}): { extraCommissionPct: number; source: "request" | "cabinet" | "none" } {
  if (input.requested != null) return { extraCommissionPct: input.requested, source: "request" };
  if (input.cabinet != null) return { extraCommissionPct: input.cabinet, source: "cabinet" };
  return { extraCommissionPct: 0, source: "none" };
}
