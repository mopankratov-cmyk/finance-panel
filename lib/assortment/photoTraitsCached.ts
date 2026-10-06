import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { TRAITS_REPORT_VERSION, type PhotoTraitsReport } from "./catalogAi";
import { loadPhotoTraits, loadQueueDirect, type QueueFacts } from "./catalogAiStore";
import type { AssortmentDirection } from "./constants";

class NoReport extends Error {}
/** Пока разбор идёт сотнями в час, отчёт в кэше на час был бы заметно устаревшим: до этого числа моделей его не кэшируем. */
export const CACHE_FROM_ANALYZED = 300;
class Uncached extends Error {
  constructor(readonly report: PhotoTraitsReport) {
    super("uncached");
  }
}

/**
 * Отчёт по признакам с часовым кэшем (при ≥300 разобранных) — один на блок «Признаки по фото» и на полоску «На чём стоят
 * цифры»: числа «разобрано N из M» в обоих местах одни и те же по построению. null — таблицы нет или ничего не разобрано;
 * пустой результат в кэш не кладётся.
 */
export async function loadPhotoTraitsCached(db: SupabaseClient, direction: AssortmentDirection): Promise<PhotoTraitsReport | null> {
  return loadHourlyDashboard(`assortment-photo-traits-v${TRAITS_REPORT_VERSION}`, { direction }, async () => {
    const result = await loadPhotoTraits(db, direction);
    if (!result) throw new NoReport();
    if (result.analyzed < CACHE_FROM_ANALYZED) throw new Uncached(result);
    return result;
  }).catch((error) => {
    if (error instanceof NoReport) return null;
    if (error instanceof Uncached) return error.report;
    throw error;
  });
}

/** Очередь раздела без отчёта по признакам — с часовым кэшем: чтение тяжёлое, а у раздела, где ничего не разобрано, число стоит на месте. */
export async function loadQueueCached(db: SupabaseClient, direction: AssortmentDirection): Promise<QueueFacts> {
  // «Нет вида каталога» в кэш не кладём: после применения миграции полоска не должна час говорить «каталога нет».
  class Missing extends Error {
    constructor(readonly facts: QueueFacts) {
      super("catalog_missing");
    }
  }
  // v2: в очереди появилось «вне разбора» по источникам — после выкладки старая форма из кэша не живёт.
  return loadHourlyDashboard("assortment-queue-direct-v2", { direction }, async () => {
    const facts = await loadQueueDirect(db, direction);
    if (facts.catalogMissing) throw new Missing(facts);
    return facts;
  }).catch((error) => {
    if (error instanceof Missing) return error.facts;
    throw error;
  });
}
