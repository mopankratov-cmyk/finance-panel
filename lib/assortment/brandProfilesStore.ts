import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingAssortmentSchema } from "./errors";
import { BRAND_DEFAULTS, defaultProfile, profileFromRow, type BrandProfile, type ProfilePatch } from "./brandProfiles";

const TABLE = "assortment_brand_profile";

export class ProfileTableMissingError extends Error {
  constructor() {
    super("Профили брендов пока не сохраняются: нужно применить миграцию 202610050004_assortment_brand_profile.sql.");
  }
}

export class ProfileConflictError extends Error {
  constructor() {
    super("Профиль уже изменён в другом окне — обновите страницу и внесите правки заново.");
  }
}

function tableMissing(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

export interface ProfilesResult {
  profiles: BrandProfile[];
  /** false — таблицы ещё нет (миграция не применена): профили показываем пустыми и сохранить нельзя. */
  persisted: boolean;
}

/** Три профиля владельца; чего нет в базе — пустой черновик из кода. */
export async function loadProfiles(db: SupabaseClient): Promise<ProfilesResult> {
  const { data, error } = await db.from(TABLE).select("*");
  if (error) {
    if (tableMissing(error)) return { profiles: BRAND_DEFAULTS.map((p) => ({ ...p })), persisted: false };
    throw new Error(error.message);
  }
  const rows = new Map((data ?? []).map((row) => [String((row as { brand_key: string }).brand_key), row as Record<string, unknown>]));
  return {
    profiles: BRAND_DEFAULTS.map((base) => {
      const row = rows.get(base.brandKey);
      return (row ? profileFromRow(row) : null) ?? { ...base };
    }),
    persisted: true,
  };
}

/** Сохранить профиль; версия защищает от тихой перезаписи чужой правки. Возвращает сохранённый профиль. */
export async function saveProfile(db: SupabaseClient, brandKey: string, patch: ProfilePatch, who: string, now = new Date()): Promise<BrandProfile> {
  const base = defaultProfile(brandKey);
  if (!base) throw new Error("Неизвестный бренд");
  const nowIso = now.toISOString();
  const values = {
    audience: patch.audience,
    fit_forms: patch.fitForms,
    avoid_forms: patch.avoidForms,
    seasons: patch.seasons,
    palette: patch.palette,
    notes: patch.notes,
    source_ref: patch.sourceRef,
    status: patch.confirmed ? "confirmed" : "draft",
    confirmed_at: patch.confirmed ? nowIso : null,
    confirmed_by: patch.confirmed ? who : null,
    updated_at: nowIso,
    updated_by: who,
  };

  const existing = await db.from(TABLE).select("brand_key,version").eq("brand_key", brandKey).maybeSingle();
  if (existing.error) {
    if (tableMissing(existing.error)) throw new ProfileTableMissingError();
    throw new Error(existing.error.message);
  }
  if (!existing.data) {
    // Строки-черновики сеет миграция; если её нет (строку удалили) — заводим заново.
    if (patch.version !== 0) throw new ProfileConflictError();
    const inserted = await db.from(TABLE).insert({ brand_key: brandKey, direction: base.direction, display_name: base.displayName, wb_brand_names: base.wbBrandNames, version: 1, ...values }).select("*").maybeSingle();
    if (inserted.error) {
      // Параллельная вставка того же ключа — это конфликт версий, а не сбой.
      if (inserted.error.code === "23505") throw new ProfileConflictError();
      throw new Error(inserted.error.message);
    }
    return profileFromRow(inserted.data as Record<string, unknown>) ?? base;
  }
  // Новая запись в базе стартует с версии 1, а форма пустого профиля держит 0: считаем их одной «первой» версией.
  const current = Number((existing.data as { version: number }).version);
  const expected = patch.version === 0 ? 1 : patch.version;
  if (current !== expected) throw new ProfileConflictError();
  const updated = await db.from(TABLE).update({ ...values, version: current + 1 }).eq("brand_key", brandKey).eq("version", current).select("*");
  if (updated.error) throw new Error(updated.error.message);
  if (!updated.data || updated.data.length === 0) throw new ProfileConflictError();
  return profileFromRow(updated.data[0] as Record<string, unknown>) ?? base;
}
