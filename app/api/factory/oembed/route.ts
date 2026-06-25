import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Обложки/эмбеды конкурентных видео через oEmbed (TikTok/YouTube — публичные, без ключа).
// Кэш в viral_videos (cover_url/embed_html/oembed_at), чтобы не долбить повторно. Best-effort.
//   POST { ids:[viral_video_id...] } → [{ id, cover_url, embed_html }]
// Лента вызывает один раз после загрузки → серые карточки превращаются в обложки + инлайн-плеер.

function oembedUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (/tiktok\.com/.test(u)) return `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  if (/youtube\.com|youtu\.be/.test(u)) return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  if (/vimeo\.com/.test(u)) return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  return null; // instagram требует FB-токен; vk/прочее — без oEmbed → серая карточка с клик-открытием
}

async function fetchOembed(url: string): Promise<{ thumbnail_url?: string; html?: string } | null> {
  const api = oembedUrl(url);
  if (!api) return null;
  try {
    const r = await fetch(api, { headers: { "User-Agent": "Mozilla/5.0 (factory oembed)" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { thumbnail_url?: string; html?: string };
    return { thumbnail_url: j.thumbnail_url, html: j.html };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, items: [] });
  const b = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: unknown) => Number(x)).filter(Boolean).slice(0, 30) : [];
  if (!ids.length) return NextResponse.json({ ok: true, items: [] });

  let rows: { id: number; url: string; cover_url: string | null; embed_html: string | null; oembed_at: string | null }[] = [];
  try {
    const { data } = await db.from("viral_videos").select("id,url,cover_url,embed_html,oembed_at").in("id", ids);
    rows = (data as typeof rows) || [];
  } catch {
    return NextResponse.json({ ok: true, items: [], note: "миграция 20260621_viral_covers не применена" });
  }

  const dayAgo = Date.now() - 24 * 3600 * 1000;
  await Promise.all(rows.map(async (row) => {
    // уже есть обложка ИЛИ недавно пробовали (и не вышло) → не дёргаем
    if (row.cover_url) return;
    if (row.oembed_at && new Date(row.oembed_at).getTime() > dayAgo) return;
    const oe = row.url ? await fetchOembed(row.url) : null;
    try {
      await db.from("viral_videos").update({
        cover_url: oe?.thumbnail_url || null,
        embed_html: oe?.html || null,
        oembed_at: new Date().toISOString(),
      }).eq("id", row.id);
    } catch { /* кэш best-effort */ }
    row.cover_url = oe?.thumbnail_url || null;
    row.embed_html = oe?.html || null;
  }));

  return NextResponse.json({ ok: true, items: rows.map((r) => ({ id: r.id, cover_url: r.cover_url, embed_html: r.embed_html })) });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      items: [],
      note: "oembed crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}
