import { NextRequest, NextResponse } from "next/server";
import { tgReady, tgSendMessage, tgSendReview } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ReviewVideo {
  recipe_id?: unknown;
  url?: unknown;
  caption?: unknown;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!tgReady()) return NextResponse.json({ ok: false, error: "FACTORY_TG_BOT_TOKEN не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const videos = Array.isArray(body.videos) ? body.videos.slice(0, 10) as ReviewVideo[] : [];
    if (!videos.length) return NextResponse.json({ ok: false, error: "нужен videos[]" }, { status: 400 });

    const results = [];
    for (const row of videos) {
      const recipeId = Number(row.recipe_id);
      const url = String(row.url || "").trim();
      const caption = String(row.caption || "Новый ролик на ревью").trim();
      if (!recipeId || !/^https?:\/\//i.test(url)) {
        results.push({ recipe_id: recipeId || null, ok: false, error: "bad recipe_id/url" });
        continue;
      }
      let sent = await tgSendReview(url, caption, recipeId);
      let fallback = false;
      if (!sent?.ok) {
        fallback = true;
        sent = await tgSendMessage(`${caption}\n\n${url}\n\n#r${recipeId} · если Telegram не показал видео, открой ссылку и ответь сюда голосом/текстом.`);
      }
      results.push({ recipe_id: recipeId, ok: !!sent?.ok, fallback, error: sent?.error || sent?.description || null, message_id: sent?.result?.message_id || null });
      await new Promise((r) => setTimeout(r, 700));
    }
    return NextResponse.json({ ok: results.every((r) => r.ok), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "telegram/send-review crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
