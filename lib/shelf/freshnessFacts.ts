import type { SupabaseClient } from "@supabase/supabase-js";

import type { ShelfFreshnessFacts } from "@/lib/shelf/freshness";

/**
 * Факты свежести «Полок» из базы: сколько артикулов ждут сбора, когда панель
 * последний раз приняла снимок и когда он был снят. `cabinetId = null` — все
 * кабинеты сразу: сборщик один на всех, так его видит тревога.
 *
 * Отслеживания — любого назначения: и полки, и цены конкурентов снимает один и
 * тот же сборщик одним кругом. Последний снимок берётся по всему срезу, а не по
 * окну истории экрана: застой длиннее окна иначе выглядел бы как «снимков нет».
 */
export async function loadShelfFreshnessFacts(db: SupabaseClient, cabinetId: string | null): Promise<ShelfFreshnessFacts> {
  let watches = db.from("wb_shelf_watch").select("id", { count: "exact", head: true }).eq("active", true);
  let byIngest = db.from("wb_shelf_snapshots").select("created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(1);
  let byCollect = db.from("wb_shelf_snapshots").select("collected_at").order("collected_at", { ascending: false }).limit(1);
  if (cabinetId) {
    watches = watches.eq("cabinet_id", cabinetId);
    byIngest = byIngest.eq("cabinet_id", cabinetId);
    byCollect = byCollect.eq("cabinet_id", cabinetId);
  }
  const [watchResult, ingestResult, collectResult] = await Promise.all([watches, byIngest, byCollect]);
  const error = watchResult.error ?? ingestResult.error ?? collectResult.error;
  if (error) throw new Error(`Свежесть «Полок» не прочиталась: ${error.message}`);
  const ingestRow = (ingestResult.data?.[0] ?? null) as { created_at?: string | null } | null;
  const collectRow = (collectResult.data?.[0] ?? null) as { collected_at?: string | null } | null;
  return {
    activeWatches: watchResult.count ?? 0,
    lastIngestAt: ingestRow?.created_at ?? null,
    lastCollectedAt: collectRow?.collected_at ?? null,
    snapshots: ingestResult.count ?? 0,
  };
}
