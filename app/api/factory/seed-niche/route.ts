import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchViral, hasTrendSource, trendSourceName } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// #4 «Найти конкурентов» для ПУСТОЙ ниши: тянет залетевшие видео из источника трендов
// (Apify TikTok-скрапер / Virlo get_trending_videos — скрап у провайдера, гео-блок РФ не мешает) и
// сеет в viral_videos под этой нишей. Лента экрана 02 (Анализ конкурентов) перестаёт быть тупиком.
// Дешёвый синхронный путь (один вызов, ≤55с), НЕ медленный Orbit (search_keywords, ~15-20 мин).
// POST { niche, query? } → { ok, niche, found, inserted, source } | { error }
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    if (!hasTrendSource()) return NextResponse.json({ error: "источник трендов не настроен (добавь APIFY_TOKEN или VIRLO_API_KEY в Vercel)" }, { status: 503 });

    const body = (await req.json().catch(() => ({}))) as { niche?: string; query?: string };
    const niche = String(body.niche || "").trim();
    if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });
    const query = String(body.query || niche).trim().slice(0, 80);

    const vids = await fetchViral(query, 24);
    const found = vids.length;
    if (!found) return NextResponse.json({ ok: true, niche, found: 0, inserted: 0, source: trendSourceName(), note: "источник не вернул видео по запросу — попробуй другой запрос/нишу" });

    const rows = vids
      .map((v) => {
        const url = String(v.url || "").trim();
        if (!url) return null;
        const views = Number(v.views) || 0;
        // у trending нет followers → log(views) как грубый прокси виральности (лента сортируется по virality_score)
        const score = views > 0 ? Math.round(Math.log(views) * 100) / 100 : null;
        return {
          niche, platform: "tiktok", url,
          views: views || null, likes: Number(v.likes) || null,
          virality_score: score,
          caption: (v.caption || v.title || "").toString().slice(0, 2000) || null,
          source_orbit_id: "trending:" + query.slice(0, 40),
          analyzed: false,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    let inserted = 0;
    if (rows.length) {
      // upsert по url, дубли пропускаем (как corpus/sync-orbit) — не сбрасываем analyzed уже разобранных
      const { error, count } = await db.from("viral_videos").upsert(rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
      if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });
      inserted = count ?? rows.length;
    }
    return NextResponse.json({ ok: true, niche, found, inserted, source: trendSourceName() });
  } catch (e) {
    return NextResponse.json({ error: "seed-niche crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
