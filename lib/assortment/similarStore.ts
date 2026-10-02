import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssortmentDirection } from "./constants";
import { MAX_DISTANCE, similarityPercent } from "./similar";
import { signedUrls } from "./storage";

export interface SimilarModel {
  id: string;
  title: string;
  brand: string | null;
  coverUrl: string | null;
  similarity: number;
  sameBrand: boolean;
}

export type SimilarResult =
  | { state: "ready"; items: SimilarModel[] }
  | { state: "not_ready"; reason: string };

/**
 * Похожие модели того же раздела по отпечаткам фото. Пока отпечатков нет —
 * честно «ещё не посчитано», а не пустой список.
 */
export async function loadSimilar(db: SupabaseClient, referenceId: string, direction: AssortmentDirection, brand: string | null): Promise<SimilarResult> {
  const { count, error: ownError } = await db.from("assortment_media_embeddings")
    .select("media_id", { count: "exact", head: true })
    .eq("reference_id", referenceId)
    .not("embedding", "is", null);
  if (ownError) return { state: "not_ready", reason: "Поиск похожих по фото ещё не подключён." };
  if (!count) return { state: "not_ready", reason: "Отпечаток фото этой модели ещё не посчитан — сборщик на mini делает это раз в 15 минут." };

  const { data, error } = await db.rpc("assortment_similar_models", { p_reference_id: referenceId, p_limit: 24 });
  if (error) return { state: "not_ready", reason: "Поиск похожих по фото ещё не подключён." };
  const close = ((data ?? []) as Array<{ reference_id: string; distance: number }>).filter((row) => row.distance <= MAX_DISTANCE);
  if (close.length === 0) return { state: "ready", items: [] };

  const ids = close.map((row) => row.reference_id);
  const [{ data: refs }, { data: media }] = await Promise.all([
    db.from("assortment_references").select("id,title,brand,direction,status").in("id", ids),
    db.from("assortment_media").select("reference_id,storage_path,position").in("reference_id", ids).order("position", { ascending: true }),
  ]);
  const byId = new Map((refs ?? []).filter((r) => r.direction === direction && r.status !== "archived").map((r) => [String(r.id), r]));
  const cover = new Map<string, string>();
  for (const m of media ?? []) if (!cover.has(String(m.reference_id)) && m.storage_path) cover.set(String(m.reference_id), String(m.storage_path));
  const urls = await signedUrls(db, [...cover.values()]);
  const ownBrand = (brand ?? "").trim().toLowerCase();
  const items = close
    .filter((row) => byId.has(row.reference_id))
    .slice(0, 8)
    .map((row) => {
      const ref = byId.get(row.reference_id)!;
      const path = cover.get(row.reference_id);
      return {
        id: row.reference_id,
        title: String(ref.title ?? ""),
        brand: ref.brand ? String(ref.brand) : null,
        coverUrl: path ? urls.get(path) ?? null : null,
        similarity: similarityPercent(row.distance),
        sameBrand: Boolean(ownBrand) && String(ref.brand ?? "").trim().toLowerCase() === ownBrand,
      };
    });
  return { state: "ready", items };
}
