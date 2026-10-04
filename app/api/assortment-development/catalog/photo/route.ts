import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { sniffImageMime } from "@/lib/ctrtest/pinImage";
import { thumbUrl } from "@/lib/assortment/catalog";
import { catalogImageUrl } from "@/lib/assortment/catalogStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { safeFetch } from "@/lib/assortment/safeFetch";
import { MAX_IMAGE_BYTES } from "@/lib/assortment/storage";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Запасной путь фото каталога: браузер не смог открыть картинку с сайта бренда
 * сам (например, сайт не отдаёт её в РФ) — панель приносит её один раз, ничего
 * не сохраняя. Адрес берётся только из базы обхода этой модели, не из запроса.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const source = params.get("source") ?? "";
  const item = params.get("item") ?? "";
  const index = Math.max(0, Math.min(Number(params.get("n")) || 0, 3));
  if (!/^S\d{3,4}$/.test(source) || !item || item.length > 300) return NextResponse.json({ error: "Неверная модель" }, { status: 400 });
  try {
    const raw = await catalogImageUrl(db, source, item, index);
    const url = raw ? thumbUrl(raw) : null;
    if (!url) return NextResponse.json({ error: "Фото нет" }, { status: 404 });
    const response = await safeFetch(url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 12_000, accept: "image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.5" });
    const mime = sniffImageMime(response.body);
    if (!mime) return NextResponse.json({ error: "Это не картинка" }, { status: 502 });
    return new NextResponse(new Uint8Array(response.body), { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "Сайт бренда не отдал фото" }, { status: 502 });
  }
}
