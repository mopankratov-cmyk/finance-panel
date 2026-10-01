import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { ASSORTMENT_BUCKET, ensureAssortmentBucket, IMAGE_MIME, MAX_IMAGE_BYTES, uploadPath } from "@/lib/assortment/storage";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Ссылка на прямую загрузку фото в приватное хранилище модуля — в обход
 * лимита тела запроса Vercel. Файл проверяется по байтам при импорте.
 */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { mime?: unknown; size?: unknown } | null;
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const size = Number(body?.size ?? 0);
  if (!(IMAGE_MIME as readonly string[]).includes(mime)) {
    return NextResponse.json({ error: "Нужно фото JPEG, PNG или WebP" }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Фото больше 10 МБ — уменьшите его" }, { status: 413 });
  }
  try {
    await ensureAssortmentBucket(db);
    const path = uploadPath(mime);
    const { data, error } = await db.storage.from(ASSORTMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "нет данных");
    return NextResponse.json({ path, signedUrl: data.signedUrl });
  } catch (error) {
    return NextResponse.json({ error: `Не удалось выдать ссылку на загрузку: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
  }
}
