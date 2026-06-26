import { NextRequest, NextResponse } from "next/server";
import { falCompose } from "@/lib/factory/falVideo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// P0-оверлей: накладывает прозрачный PNG (хук-текст + субтитры) и опц. аудио на готовый ролик
// через fal compose (image-трек поверх video). Служит и точкой одного живого смоук-теста:
// POST {video_url, overlay_url} → ждём, что в ответном video_url текст вшит поверх видео.
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const videoUrl: string = (body.video_url || "").toString().trim();
  const overlayUrl: string = (body.overlay_url || "").toString().trim();
  const audioUrl: string = (body.audio_url || "").toString().trim();
  const duration = Number(body.duration) || 5;
  if (!videoUrl) return NextResponse.json({ error: "Нужен video_url" }, { status: 400 });
  if (!overlayUrl && !audioUrl) return NextResponse.json({ error: "Нужен overlay_url или audio_url" }, { status: 400 });

  try {
    const r = await falCompose(videoUrl, { overlayUrl: overlayUrl || undefined, audioUrl: audioUrl || undefined, durationSec: duration });
    if (r.error || !r.videoUrl) return NextResponse.json({ error: r.error || "compose без видео" }, { status: 502 });
    return NextResponse.json({ video_url: r.videoUrl });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 }); }
  } catch (e) {
    return NextResponse.json({
      error: "overlay crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
