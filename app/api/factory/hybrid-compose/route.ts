import { NextRequest, NextResponse } from "next/server";
import { falTimeline, type FalTimelineClip } from "@/lib/factory/falVideo";
import { rehostImageForFal } from "@/lib/factory/rehostImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// U2 гибридный монтаж: актёр-видео (talking-head хук) + реальные фото/видео товара.
// Последовательный таймлайн: actor(0-N сек) → product_images(N-M сек) → optional actor outro.
// POST {
//   actor_video_url — URL готового Creatify lipsync/talking-head (обязателен),
//   product_images[] — URLs реальных фото товара (Яндекс.Диск/WB), хотя бы 1,
//   actor_duration_sec — длительность актёра (default 3),
//   product_sec_per_image — секунд на каждое фото (default 3),
//   hook — текст хука (для логирования),
//   article — артикул (для логирования),
// }
// Возвращает { video_url } готового гибридного ролика.
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const actorUrl: string = (body.actor_video_url || "").toString().trim();
  const productImages: string[] = Array.isArray(body.product_images)
    ? body.product_images.map((u: unknown) => String(u || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  if (!actorUrl) return NextResponse.json({ error: "Нужен actor_video_url (Creatify/HeyGen видео)" }, { status: 400 });
  if (!productImages.length) return NextResponse.json({ error: "Нужны product_images (хотя бы 1 фото товара)" }, { status: 400 });

  const actorDur = Math.max(1, Math.min(10, Number(body.actor_duration_sec) || 3));
  const productSecPerImage = Math.max(1, Math.min(5, Number(body.product_sec_per_image) || 3));

  try {
    // WB-CDN флэйкит на серверной загрузке fal-compose ("file_download") → рехостим фото товара в наш бакет.
    // actorUrl не трогаем (Creatify/HeyGen видео, не WB-CDN). Best-effort: при сбое вернётся исходный url.
    const rehosted = await Promise.all(productImages.map((u) => rehostImageForFal(u)));

    // Строим таймлайн: актёр (talking-head хук) → фото товара последовательно
    // Образец U2: hook(0-3с) → product demo(3-12с). Простой, без outro актёра.
    const clips: FalTimelineClip[] = [
      { url: actorUrl, type: "video", durationSec: actorDur },
      ...rehosted.map((img) => ({ url: img, type: "image" as const, durationSec: productSecPerImage })),
    ];

    const totalDur = actorDur + productImages.length * productSecPerImage;
    const r = await falTimeline(clips, { maxWaitMs: 55000 });
    if (r.pending && r.responseUrl) {
      return NextResponse.json({
        status: "processing",
        pending_url: r.responseUrl,
        error: r.error || "timeline compose still processing",
        duration_sec: totalDur,
        clips: clips.length,
      }, { status: 202 });
    }
    if (r.error || !r.videoUrl) {
      return NextResponse.json({ error: r.error || "compose без видео" }, { status: 502 });
    }
    return NextResponse.json({
      video_url: r.videoUrl,
      duration_sec: totalDur,
      clips: clips.length,
      actor_dur: actorDur,
      product_images: productImages.length,
    });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 }); }
  } catch (e) {
    return NextResponse.json({
      error: "hybrid-compose crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
