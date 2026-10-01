/** Таблицы модуля не созданы — миграция не применена. Отвечаем честно, а не 500. */
export function isMissingAssortmentSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Только отсутствие ТАБЛИЦЫ: нехватка колонки из поздней миграции — другой
  // случай, его роуты обходят без 503 (см. isMissingColumnError).
  return /relation "?[\w.]*assortment_\w+"? does not exist|could not find the table '?[\w.]*assortment_/i.test(message);
}

/** Колонки из поздней миграции модуля ещё нет — работаем без неё. */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find the '.*' column/i.test(error.message ?? "");
}

export const BRIEF_MIGRATION = "202610020001_assortment_collection_brief.sql";

export const MIGRATION_HINT = "Таблицы модуля ещё не созданы: нужно применить миграцию 202610010005_assortment_development_schema.sql.";
