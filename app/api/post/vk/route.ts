import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Постинг в ленту VK-сообщества (wall.post). env: VK_TOKEN (ключ доступа сообщества с правами wall),
// VK_GROUP_ID (числовой id группы). Видео-клипы VK требуют отдельной multi-step загрузки —
// в v1 постим текст + ссылку (VK сам сделает превью-карточку ссылки). Загрузку видео добавим следом.
export async function POST(req: NextRequest) {
  const token = process.env.VK_TOKEN;
  if (!token) return NextResponse.json({ detail: "VK_TOKEN не настроен (Управление сообществом → Работа с API → ключ доступа с правами wall)" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const groupId: string = (body.group_id || process.env.VK_GROUP_ID || "").toString().replace(/^-/, "").trim();
  if (!groupId) return NextResponse.json({ detail: "Нужен group_id (числовой id сообщества)" }, { status: 400 });

  const message: string = [body.message || body.caption || body.hook || "", body.link || ""].filter(Boolean).join("\n\n").slice(0, 4000);
  if (!message) return NextResponse.json({ detail: "Пустой текст поста" }, { status: 400 });

  const params = new URLSearchParams({
    owner_id: `-${groupId}`,
    from_group: "1",
    message,
    access_token: token,
    v: "5.199",
  });
  if (body.link) params.set("attachments", String(body.link)); // VK сделает карточку ссылки

  try {
    const res = await fetch("https://api.vk.com/method/wall.post", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
      body: params.toString(), signal: AbortSignal.timeout(25000),
    });
    const j = (await res.json()) as { response?: { post_id?: number }; error?: { error_msg?: string } };
    if (j.error) return NextResponse.json({ detail: `VK: ${j.error.error_msg}` }, { status: 502 });
    return NextResponse.json({ ok: true, post_id: j.response?.post_id, url: `https://vk.com/wall-${groupId}_${j.response?.post_id}` });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
