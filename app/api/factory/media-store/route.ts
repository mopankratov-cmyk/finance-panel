import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logGeneration } from "@/lib/factory/genHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "factory-media"; // публичный бакет под слайды карусели/видео

// Заливает base64-картинки (слайды карусели) в Supabase Storage → отдаёт публичные URL.
// Нужно чтобы НЕМАЯ карусель (slides в base64) получила URL и доходила до автопостинга/PostMyPost.
export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error:"Supabase не настроен (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 12) : [];
  const prefix: string = (body.prefix || "slides").toString().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "slides";
  // PNG нужен для оверлея с прозрачностью (хук-текст/субтитры поверх видео); по умолчанию JPEG (слайды карусели).
  const ext = body.format === "png" ? "png" : "jpg";
  const contentType = ext === "png" ? "image/png" : "image/jpeg";
  if (!images.length) return NextResponse.json({ error:"Нет images (массив base64 без префикса data:)" }, { status: 400 });
  const recipeId = typeof body.recipe_id === "number" ? body.recipe_id : null;
  const nodeId = typeof body.node_id === "number" ? body.node_id : null;
  const parentId = typeof body.parent_id === "number" ? body.parent_id : null;
  const variantIdx = typeof body.variant_idx === "number" ? body.variant_idx : null;
  const article = (body.article || body.sku_art || "").toString().trim() || null;
  const niche = (body.niche || "").toString().trim() || null;
  const source = (body.source || "standalone").toString().trim().slice(0, 40) || "standalone";
  const reason = (body.reason || "media_store_upload").toString().trim().slice(0, 120) || "media_store_upload";
  const tool = (body.tool || "").toString().trim() || null;
  const engine = (body.engine || "").toString().trim() || null;
  const nodeType = (body.node_type || body.kind || ext).toString().trim() || ext;
  const prompt = (body.prompt || body.note || "").toString().trim() || null;
  const otkScore = typeof body.otk_score === "number" ? body.otk_score : null;
  const otkAxes = body.otk_axes ?? null;
  const historyEnabled = body.log_history !== false;
  const logMediaStoreHistory = async (outputUrl: string | null, status: string, note?: string | null) => {
    if (!historyEnabled) return;
    await logGeneration({
      recipe_id: recipeId,
      node_id: nodeId,
      parent_id: parentId,
      variant_idx: variantIdx,
      tool,
      engine,
      node_type: nodeType,
      prompt,
      output_url: outputUrl,
      otk_score: otkScore,
      otk_axes: otkAxes,
      status,
      source,
      reason: note || reason,
      niche,
      article,
    });
  };

  // создать бакет (идемпотентно — если есть, проигнорим ошибку)
  try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* уже существует */ }

  const urls: string[] = [];
  const errors: string[] = [];
  const stamp = Date.now();
  for (let i = 0; i < images.length; i++) {
    try {
      const b64 = images[i].replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const path = `${prefix}/${stamp}-${i}.${ext}`;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
      if (error) { errors.push(`#${i}: upload ${error.message}`); continue; }
      const { data } = db.storage.from(BUCKET).getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
      else errors.push(`#${i}: publicUrl missing`);
    } catch (e) { errors.push(`#${i}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`); }
  }
  if (!urls.length) {
    await logMediaStoreHistory(null, "artifact_fail", errors[0] || "media_store_upload_failed");
    return NextResponse.json({ error:"не удалось залить ни один слайд", attempted: images.length, failed: errors.slice(0, 5) }, { status: 502 });
  }
  await logMediaStoreHistory(urls[0], typeof otkScore === "number" && otkScore < 7 ? "warning" : "generated", errors[0] || reason);
  return NextResponse.json({ urls, uploaded: urls.length, skipped: Math.max(0, images.length - urls.length), warnings: errors.slice(0, 5) });
  } catch (e) {
    return NextResponse.json({
      urls: [],
      uploaded: 0,
      skipped: 0,
      warnings: [],
      error: "сохранение медиа упало: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
