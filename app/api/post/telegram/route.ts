import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Постинг в Telegram-канал через Bot API. Бот должен быть админом канала.
// env: TELEGRAM_BOT_TOKEN. Цель — @username канала или числовой chat_id (можно прислать в body.channel).
export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ detail: "TELEGRAM_BOT_TOKEN не настроен (создай бота у @BotFather, добавь админом в канал)" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const channel: string = (body.channel || process.env.TELEGRAM_CHANNEL || "").toString().trim();
  if (!channel) return NextResponse.json({ detail: "Нужен channel (@username канала или chat_id)" }, { status: 400 });

  const videoUrl: string = (body.video_url || "").toString().trim();
  const caption: string = [body.caption || body.hook || "", body.link || ""].filter(Boolean).join("\n\n").slice(0, 1000);

  const api = `https://api.telegram.org/bot${token}`;
  try {
    let res: Response;
    if (videoUrl) {
      // Telegram сам скачает видео по URL (до 20 МБ через URL; крупнее — нужен upload/локальный Bot API сервер)
      res = await fetch(`${api}/sendVideo`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(50000),
        body: JSON.stringify({ chat_id: channel, video: videoUrl, caption, supports_streaming: true }),
      });
    } else {
      res = await fetch(`${api}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ chat_id: channel, text: caption || "(пусто)", disable_web_page_preview: false }),
      });
    }
    const j = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!j.ok) return NextResponse.json({ detail: `Telegram: ${j.description || res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, message_id: j.result?.message_id, channel });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
