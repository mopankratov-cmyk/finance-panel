import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Проставить только что собранным кодам владельца.
 *
 * Зовётся в конце каждого сборщика. Отдельным шагом, а не полем при вставке,
 * по двум причинам: запись идёт через upsert с ignoreDuplicates и существующую
 * строку не трогает, а правило владельца одно на все источники — держать его в
 * четырёх местах значит однажды получить четыре разных ответа.
 *
 * Ошибку глотаем намеренно: сбор кодов важнее подписи под ними. Не привязанный
 * код виден на экране отдельной строкой, а не пропадает.
 */
export async function attachKizEntities(db: SupabaseClient): Promise<{ attached: number; left: number } | null> {
  const { data, error } = await db.rpc("kiz_attach_legal_entity");
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    attached: Number(row.attached ?? 0) || 0,
    left: Number(row.left ?? 0) || 0,
  };
}
