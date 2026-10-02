import { NextRequest, NextResponse } from "next/server";
import { checkAssortmentCollectorAuth } from "@/lib/assortment/collectorAuth";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { signedUrls } from "@/lib/assortment/storage";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Очередь сборщика отпечатков (Mac mini): фото моделей без отпечатка и
 * короткие подписанные ссылки на них. Без сессии — по секрету сборщика.
 */
export async function GET(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const limit = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 24));
  const { data, error } = await db.from("assortment_embedding_queue").select("media_id,storage_path").limit(limit);
  if (error) {
    if (isMissingAssortmentSchema(error) || /assortment_embedding_queue/.test(error.message)) {
      return NextResponse.json({ items: [], skipped: "миграция 202610030001 не применена" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []).filter((row) => row.storage_path);
  const urls = await signedUrls(db, rows.map((row) => String(row.storage_path)));
  return NextResponse.json({
    items: rows
      .map((row) => ({ mediaId: String(row.media_id), url: urls.get(String(row.storage_path)) ?? null }))
      .filter((item): item is { mediaId: string; url: string } => Boolean(item.url)),
  });
}
