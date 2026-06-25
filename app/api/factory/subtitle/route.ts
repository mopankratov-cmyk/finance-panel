import { NextRequest, NextResponse } from "next/server";
import { falAutoSubtitle } from "@/lib/factory/falVideo";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// #15 · Авто-субтитры со словесной караоке-подсветкой, выжженные в готовое видео (главный native-feel рывок
// для Reels/TikTok). Заменяет/дополняет статичный PNG-капшен. Дефолты под канон: RU, Montserrat, акцент cyan, низ.
//
// POST { video_url, language?, font_name?, font_size?, font_color?, highlight_color?, position?, animation? }
//   → { ok, video_url, words? }  |  { error }
export async function POST(req: NextRequest) {
  try {
    if (!process.env.FAL_KEY) return NextResponse.json({ error: "FAL_KEY не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const videoUrl: string = (body.video_url || body.url || "").toString().trim();
    if (!videoUrl) return NextResponse.json({ error: "нужен video_url" }, { status: 400 });

    const r = await falAutoSubtitle(videoUrl, {
      language: body.language,
      fontName: body.font_name,
      fontSize: typeof body.font_size === "number" ? body.font_size : undefined,
      fontColor: body.font_color,
      highlightColor: body.highlight_color,
      position: ["top", "center", "bottom"].includes(body.position) ? body.position : undefined,
      animation: typeof body.animation === "boolean" ? body.animation : undefined,
    });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, video_url: r.videoUrl, words: r.words });
  } catch (e) {
    return NextResponse.json({ error: "subtitle crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
