import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClipPulse } from "./freshness";

/** Сколько фото очереди отпечатков смотрим, чтобы найти давно ждущее (вид очереди без порядка — выборка, а не вся очередь). */
const QUEUE_SAMPLE = 50;

/**
 * Пульс отпечатков фото (CLIP на Mac mini) для сторожа: время последнего отпечатка (строка `assortment_media_embeddings`, в том числе с
 * ошибкой фото — mini жив) и самое старое фото среди ждущих в очереди. null — таблиц нет (миграция 202610030001) или чтение не удалось:
 * сторож отпечатки тогда не судит, а сторож источников работает как раньше.
 */
export async function loadClipPulse(db: SupabaseClient): Promise<ClipPulse | null> {
  try {
    const last = await db.from("assortment_media_embeddings").select("created_at").order("created_at", { ascending: false }).limit(1);
    if (last.error) return null;
    const lastEmbeddingAt = ((last.data ?? []) as Array<{ created_at: string | null }>)[0]?.created_at ?? null;
    const queue = await db.from("assortment_embedding_queue").select("media_id").limit(QUEUE_SAMPLE);
    if (queue.error) return null;
    const ids = ((queue.data ?? []) as Array<{ media_id: string | null }>).map((r) => r.media_id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return { lastEmbeddingAt, oldestWaitingAt: null };
    const media = await db.from("assortment_media").select("created_at").in("id", ids);
    if (media.error) return null;
    const times = ((media.data ?? []) as Array<{ created_at: string | null }>).map((m) => m.created_at).filter((t): t is string => Boolean(t)).sort();
    return { lastEmbeddingAt, oldestWaitingAt: times[0] ?? null };
  } catch {
    return null;
  }
}
