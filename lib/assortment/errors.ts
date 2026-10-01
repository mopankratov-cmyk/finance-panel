/** Таблицы модуля не созданы — миграция не применена. Отвечаем честно, а не 500. */
export function isMissingAssortmentSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /assortment_/.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

export const MIGRATION_HINT = "Таблицы модуля ещё не созданы: нужно применить миграцию 202610010005_assortment_development_schema.sql.";
