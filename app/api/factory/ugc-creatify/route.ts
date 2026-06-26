import { NextRequest, NextResponse } from "next/server";
import { creatifyLinkVideo, creatifyLipsync, creatifyReady } from "@/lib/factory/creatify";
import { internalFetch } from "@/lib/internalFetch";
import { analyzeScenarioQuality } from "@/lib/factory/scenarioQuality";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ScenarioQualityResultWithWarnings = Awaited<ReturnType<typeof analyzeScenarioQuality>> & { warnings?: string[] };

// UGC-актёр Creatify. Если есть товар (URL карточки WB) → link_to_videos (актёр + ПОКАЗ товара).
// Иначе → lipsyncs (актёр просто говорит текст). Async: task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  try {
  if (!creatifyReady()) {
    const error = "Creatify не подключён: добавь CREATIFY_API_ID и CREATIFY_API_KEY в Vercel env";
    return NextResponse.json({ error }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const script: string = (body.script || body.brief || body.hook || "").toString().trim();
  const debugMode = body.debug === true;
  let url: string = (body.product_url || "").toString().trim();
  let images: string[] = Array.isArray(body.images) ? body.images : [];
  let videoUrls: string[] = Array.isArray(body.video_urls) ? body.video_urls.map((v: unknown) => String(v).trim()).filter(Boolean) : [];
  const overrideVoice = (body.override_voice || body.voice_id || "").toString().trim();
  const backgroundMusicUrl = (body.background_music_url || body.music_url || "").toString().trim();
  const backgroundMusicVolume = typeof body.background_music_volume === "number" ? body.background_music_volume : undefined;
  const noBackgroundMusic = typeof body.no_background_music === "boolean" ? body.no_background_music : undefined;
  const noCaption = typeof body.no_caption === "boolean" ? body.no_caption : undefined;
  const noStockBroll = typeof body.no_stock_broll === "boolean" ? body.no_stock_broll : undefined;
  const voiceoverVolume = typeof body.voiceover_volume === "number" ? body.voiceover_volume : undefined;
  const modelVersion = (body.model_version || "").toString().trim() || undefined;
  const noCta = typeof body.no_cta === "boolean" ? body.no_cta : undefined;
  let title = "";

  // резолв фото+названия+URL карточки WB по артикулу (nm_id из rnp_report). Фото отдаём Creatify напрямую.
  if ((!images.length || !url) && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { getWbCardImage } = await import("@/lib/wb/cardImage");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");

        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) {
          if (!url) url = `https://www.wildberries.ru/catalog/${row.nm_id}/detail.aspx`;
          title = (row.name as string) || "";
          if (!images.length) { const img = await getWbCardImage(Number(row.nm_id)); if (img) images = [img]; }
        }
      }
    } catch { /* без фото — уйдём в lipsync */ }
  }

  const quality = script
    ? await analyzeScenarioQuality({
        article: String(body.sku_art || body.article || ""),
        product_name: title || String(body.brief || "").trim(),
        niche: String(body.niche || body.category || "default"),
        scenario: script,
        hooks: body.hook ? [String(body.hook)] : [],
        visual_beats: Array.isArray(body.visual_beats) ? body.visual_beats : String(body.visual_beats || ""),
        threshold: typeof body.threshold === "number" ? body.threshold : undefined,
      })
    : null;

  if (quality && quality.should_render === false) {
    (quality as ScenarioQualityResultWithWarnings).warnings = [
      ...((quality as { warnings?: string[] }).warnings || []),
      "quality gate failed but render continues in fail-open stabilization mode",
    ];
  }

  if (!videoUrls.length && body.sku_art) {
    try {
      const r = await internalFetch(`${req.nextUrl.origin}/api/factory/disk-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: String(body.sku_art), product: title || (body.brief || "").toString() || url }),
        signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d && Array.isArray((d as { videos?: unknown[] }).videos)) {
        videoUrls = ((d as { videos?: { url?: unknown }[] }).videos || [])
          .map((v) => String(v?.url || "").trim())
          .filter(Boolean)
          .slice(0, 8);
      }
    } catch { /* видео — best effort */ }
  }

  if (images.length || url || videoUrls.length) {
    const res = await creatifyLinkVideo({
      url: url || undefined,
      images,
      videoUrls,
      title: title || (body.brief || "").toString(),
      description: script || (body.brief || "").toString(),
      script: script || undefined,
      avatar: (body.creator || body.avatar || "").trim() || undefined,
      visual_style: (body.visual_style || "").toString().trim() || undefined,
      override_voice: overrideVoice || undefined,
      background_music_url: backgroundMusicUrl || undefined,
      background_music_volume: backgroundMusicVolume,
      no_background_music: noBackgroundMusic,
      no_caption: noCaption,
      no_stock_broll: noStockBroll,
      voiceover_volume: voiceoverVolume,
      model_version: modelVersion,
      no_cta: noCta,
    });
    if (res.error || !res.token) {
      const error = res.error || "Creatify не запустил";
      return NextResponse.json({ error, ...(debugMode ? { debug: res.debug } : {}), ...(quality ? { quality_gate: quality } : {}) }, { status: 502 });
    }
    return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify", mode: "link_to_videos", product_url: url, ...(quality ? { quality_gate: quality } : {}), ...(debugMode ? { debug: res.debug } : {}) });
  }

  if (!script) {
    const error = "Нужен товар (артикул/URL) или текст для актёра";
    return NextResponse.json({ error }, { status: 400 });
  }
  const res = await creatifyLipsync(script, { creator: (body.creator || "").trim() || undefined });
  if (res.error || !res.token) {
    const error = res.error || "Creatify не запустил";
    return NextResponse.json({ error }, { status: 502 });
  }
  return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify", mode: "lipsyncs" });
  } catch (e) {
    return NextResponse.json({
      error: "запуск UGC Creatify упал: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
