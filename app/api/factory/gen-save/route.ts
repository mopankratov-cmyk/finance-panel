import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFor } from "@/lib/factory/contentDisks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "factory-media";

// Сохранить ГЕНЕРАЦИЮ завода в Базу контента навсегда (disk='gen').
// Видео качаем с временной fal-ссылки → Supabase Storage → постоянный URL.
// POST { video_url?, slides?:[url...], article?, niche?, hook?, route?, engine?, otk? }
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const videoUrl: string = (b.video_url || "").toString().trim();
  const slides: string[] = Array.isArray(b.slides) ? b.slides.filter((s: unknown) => typeof s === "string") : [];
  const article: string = (b.article || b.sku_art || "").toString().trim();
  const niche: string | null = (b.niche || nicheFor((b.product_name || "").toString(), article) || null);
  if (!videoUrl && !slides.length) return NextResponse.json({ error: "нужен video_url или slides" }, { status: 400 });

  try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* есть */ }

  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const meta = { hook: b.hook || "", route: b.route || "", engine: b.engine || "", otk: b.otk ?? null, source_url: videoUrl || slides[0] || "" };

  // 1) ВИДЕО: качаем с fal (временная ссылка) → Storage → постоянный URL
  if (videoUrl) {
    // дедуп: если эта же исходная ссылка уже сохранена — не дублируем
    const { data: dup } = await db.from("content_assets").select("id,url").eq("disk", "gen").contains("analysis", { source_url: videoUrl }).maybeSingle();
    if (dup?.url) return NextResponse.json({ ok: true, already: true, url: dup.url });
    let stored = "";
    try {
      const r = await fetch(videoUrl, { signal: AbortSignal.timeout(90000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const path = `gen/${stamp}-${rand}.mp4`;
        const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "video/mp4", upsert: true });
        if (!error) stored = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || "";
      }
    } catch { /* источник мог протухнуть */ }
    if (!stored) return NextResponse.json({ ok: false, error: "не удалось скачать/залить видео (ссылка протухла?)" });
    const { error: insErr } = await db.from("content_assets").insert({
      disk: "gen", path: `gen/${stamp}-${rand}`, name: (b.hook || article || "генерация").toString().slice(0, 120),
      kind: "video", niche, article: article || null, color: null, url: stored, analyzed: true, analysis: meta,
    });
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message });
    return NextResponse.json({ ok: true, url: stored });
  }

  // 2) КАРУСЕЛЬ: слайды уже в Storage (media-store) — просто фиксируем в каталоге одной записью
  const { error: insErr } = await db.from("content_assets").insert({
    disk: "gen", path: `gen/${stamp}-${rand}`, name: (b.hook || article || "карусель").toString().slice(0, 120),
    kind: "image", niche, article: article || null, color: null, url: slides[0], analyzed: true,
    analysis: { ...meta, slides },
  });
  if (insErr) return NextResponse.json({ ok: false, error: insErr.message });
  return NextResponse.json({ ok: true, url: slides[0], slides: slides.length });
}

// GET — список сохранённых генераций (для Базы контента).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { data, error } = await db.from("content_assets").select("name,kind,url,niche,article,analysis,created_at").eq("disk", "gen").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: (data || []).length, generations: data || [] });
}
