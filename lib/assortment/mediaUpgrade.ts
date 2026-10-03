import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { hiResImageUrl } from "./brightdataCatalog";
import { remoteImage } from "./importer";
import { ASSORTMENT_BUCKET, referenceMediaPath } from "./storage";

/**
 * Перезалить уже скачанные фото магазинов в высоком разрешении (ASOS и H&M,
 * 03.10). Строка медиа остаётся та же (позиция и связь с моделью), меняются
 * файл, sha256 и адрес-источник; отпечаток фото удаляется — сборщик на mini
 * посчитает его заново по новому файлу.
 */
export async function upgradeShopImages(db: SupabaseClient, deadline: number): Promise<{ checked: number; upgraded: number; failed: number }> {
  const { data, error } = await db.from("assortment_media")
    .select("id,reference_id,storage_path,origin_url")
    .or("origin_url.ilike.%images.asos-media.com%,origin_url.ilike.%image.hm.com%")
    .limit(500);
  if (error) throw new Error(error.message);
  let upgraded = 0;
  let failed = 0;
  const rows = (data ?? []).filter((m) => m.origin_url && hiResImageUrl(String(m.origin_url)) !== String(m.origin_url));
  for (const media of rows) {
    if (Date.now() > deadline) break;
    const image = await remoteImage(hiResImageUrl(String(media.origin_url)));
    if (!image) {
      failed += 1;
      continue;
    }
    const sha = createHash("sha256").update(image.bytes).digest("hex");
    const path = referenceMediaPath(String(media.reference_id), sha, image.mime);
    const { error: uploadError } = await db.storage.from(ASSORTMENT_BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: true });
    if (uploadError) {
      failed += 1;
      continue;
    }
    const { error: rowError } = await db.from("assortment_media")
      .update({ storage_path: path, sha256: sha, origin_url: image.originUrl ?? hiResImageUrl(String(media.origin_url)) })
      .eq("id", media.id);
    if (rowError) {
      failed += 1;
      continue;
    }
    if (media.storage_path && media.storage_path !== path) await db.storage.from(ASSORTMENT_BUCKET).remove([String(media.storage_path)]);
    await db.from("assortment_media_embeddings").delete().eq("media_id", media.id);
    upgraded += 1;
  }
  return { checked: rows.length, upgraded, failed };
}
