import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Фаза C методологии CTR-тестов (ТЗ владельца 15.09.2026): пока тест идёт,
 * ставку, ключевые фразы и статус кампании трогать нельзя — любая правка
 * посреди замера рвёт сравнение вариантов.
 *
 * Заморозка не абсолютна: это защита от чужой неосторожной правки, а не гейт
 * безопасности. Если сама проверка не смогла прочитать `ctr_tests` (сбой
 * базы), правки не блокируются — молчаливо отказывать в изменении ставки
 * из-за постороннего сбоя опаснее, чем пропустить редкую гонку. Владелец сам
 * останавливает тест в /wb/ctr, если правка нужна прямо сейчас.
 */

export interface ActiveCtrTestLock {
  id: number;
  nmId: number;
  article: string | null;
}

/** По артикулу — для роутов, где nm_id уже есть в запросе (ставка, минус-фразы). */
export async function activeCtrTestForNm(db: SupabaseClient, cabinetId: string, nmId: number): Promise<ActiveCtrTestLock | null> {
  const { data, error } = await db
    .from("ctr_tests")
    .select("id, nm_id, article")
    .eq("cabinet_id", cabinetId)
    .eq("nm_id", nmId)
    .eq("test_type", "ctr")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: Number(data.id), nmId: Number(data.nm_id), article: (data.article as string | null) ?? null };
}

/**
 * По кампании — для роутов уровня campaign (старт/пауза/стоп), у которых нет
 * nm_id в запросе. Совпадает ТОЛЬКО с кампанией, реально привязанной к тесту
 * (`ctr_tests.advert_id`, Фаза A) — не с любой, что когда-либо крутила этот
 * артикул. Иначе автопауза «полок» из Фазы A (она трогает ДРУГИЕ кампании,
 * setAdvertLifecycle напрямую, мимо этого роута) рисковала бы задеть себя же,
 * если бы её логику когда-нибудь перевели на этот путь.
 */
export async function activeCtrTestForCampaign(db: SupabaseClient, cabinetId: string, advertId: number): Promise<ActiveCtrTestLock | null> {
  const { data, error } = await db
    .from("ctr_tests")
    .select("id, nm_id, article")
    .eq("cabinet_id", cabinetId)
    .eq("advert_id", advertId)
    .eq("test_type", "ctr")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: Number(data.id), nmId: Number(data.nm_id), article: (data.article as string | null) ?? null };
}

export function ctrFreezeMessage(lock: ActiveCtrTestLock): string {
  return `На артикуле ${lock.article ?? lock.nmId} идёт CTR-тест (#${lock.id}) — во время теста ставку, ключевые фразы и статус кампании менять нельзя, иначе результат станет недостоверным. Остановите тест в /wb/ctr, если правка нужна прямо сейчас.`;
}
