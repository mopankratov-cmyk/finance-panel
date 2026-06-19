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
    let diag = "";
    try {
      const r = await fetch(videoUrl, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) diag = `fetch ${r.status}`;
      else {
        const buf = Buffer.from(await r.arrayBuffer());
        const path = `gen/${stamp}-${rand}.mp4`;
        const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "video/mp4", upsert: true });
        if (error) diag = `upload: ${error.message}`;
        else stored = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || "";
      }
    } catch (e) { diag = `fetch-exc: ${String(e instanceof Error ? e.message : e).slice(0, 80)}`; }
    if (!stored) return NextResponse.json({ ok: false, error: "не удалось скачать/залить видео", diag });
    const { error: insErr } = await db.from("content_assets").insert({
      disk: "gen", path: `gen/${stamp}-${rand}`, name: (b.hook || article || "генерация").toString().slice(0, 120),
      kind: "video", niche, article: article || null, color: null, url: stored, analyzed: true, analysis: meta,
    });
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message });
    return NextResponse.json({ ok: true, url: stored });
  }

  // 2) КАРУСЕЛЬ: слайды могут прийти как base64 — заливаем в Storage, в каталог пишем ССЫЛКИ (не base64)
  const slideUrls: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.startsWith("http")) { slideUrls.push(s); continue; }
    try {
      const b64 = s.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const path = `gen/${stamp}-${rand}-${i}.jpg`;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true });
      if (!error) slideUrls.push(db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || "");
    } catch { /* пропустим битый слайд */ }
  }
  const clean = slideUrls.filter(Boolean);
  if (!clean.length) return NextResponse.json({ ok: false, error: "не удалось залить слайды карусели" });
  const { error: insErr } = await db.from("content_assets").insert({
    disk: "gen", path: `gen/${stamp}-${rand}`, name: (b.hook || article || "карусель").toString().slice(0, 120),
    kind: "image", niche, article: article || null, color: null, url: clean[0], analyzed: true,
    analysis: { ...meta, slides: clean },
  });
  if (insErr) return NextResponse.json({ ok: false, error: insErr.message });
  return NextResponse.json({ ok: true, url: clean[0], slides: clean.length });
}

// GET — список сохранённых генераций. ?clean=bad — удалить битые строки (url не ссылка, напр. base64).
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (new URL(req.url).searchParams.get("clean") === "bad") {
    const { data } = await db.from("content_assets").select("id,url").eq("disk", "gen");
    const badIds = (data || []).filter((r) => { const u = String(r.url || ""); return !u.startsWith("http"); }).map((r) => r.id);
    if (badIds.length) await db.from("content_assets").delete().in("id", badIds);
    return NextResponse.json({ cleaned: badIds.length });
  }
  const { data, error } = await db.from("content_assets").select("name,kind,url,niche,article,analysis,created_at").eq("disk", "gen").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // на всякий — не отдаём в галерею битые (не-ссылка) url
  const gens = (data || []).filter((r) => String(r.url || "").startsWith("http"));
  return NextResponse.json({ count: gens.length, generations: gens });
}
