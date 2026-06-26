import { NextRequest, NextResponse } from "next/server";
import { buildEdit, shotstackSubmit, shotstackStatus, shotstackReady } from "@/lib/factory/shotstack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ФАЗА 0.1 — смоук Shotstack: реальное фото + русский хук-текст + субтитр → mp4.
// Проверяет ДВА убийц-риска разом: (1) рисует ли Shotstack КИРИЛЛИЦУ (Noto Sans Cyrillic) или tofu-квадраты,
// (2) работает ли вообще рендер на текущем ключе/URL. $0-1 кредит, ~30с.
//   GET без id  → сабмитит тест-рендер, возвращает render_id + poll-ссылку.
//   GET ?id=X   → статус/URL готового mp4 (открыть и посмотреть глазами).
// Параметры: ?image=<url фото> ?text=<хук по-русски> ?caption=<субтитр>. Удалить после Фазы 0.
export async function GET(req: NextRequest) {
  try {
    if (!shotstackReady()) return NextResponse.json({ error: "SHOTSTACK_API_KEY не настроен в Vercel — добавь и передеплой" });

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");

    // режим опроса
    if (id) {
      const st = await shotstackStatus(id);
      return NextResponse.json({
        id,
        status: st.status,
        videoUrl: st.videoUrl,
        error: st.error,
        hint: st.status === "in_progress"
          ? "ещё рендерится — обнови эту страницу через ~15с"
          : (st.videoUrl ? "✅ ГОТОВО. Открой videoUrl в браузере и СМОТРИ: русский текст читается или квадраты (tofu)?" : "рендер не удался — см. error"),
      });
    }

    // режим сабмита
    const image = sp.get("image") || "https://shotstack-assets.s3.amazonaws.com/images/waterfall-square.jpg";
    const hook = sp.get("text") || "Вы неправильно используете санскрин";
    const caption = sp.get("caption") || "Тест кириллицы · Ищи на WB";

    // один кадр ~5с + хук-текст сверху (первые 3с, на фоне) + субтитр снизу весь ролик
    const edit = buildEdit({
      clips: [{ url: image, type: "image", start: 0, length: 5 }],
      hookText: hook,
      caption,
      aspect: "9:16",
    });

    const renderId = await shotstackSubmit(edit);
    if (!renderId) {
      return NextResponse.json({
        error: "Shotstack НЕ принял рендер. Возможные причины: неверный SHOTSTACK_API_KEY, кончились кредиты, или URL формата (/edit/v1). Проверь ключ и баланс кредитов в дашборде.",
        edit_sent: edit,
      });
    }
    return NextResponse.json({
      ok: true,
      render_id: renderId,
      poll: `/api/factory/shotstack-smoke?id=${renderId}`,
      note: "Рендер запущен. Через ~20-40с открой poll-ссылку (ниже) → получишь videoUrl. Открой видео и смотри: русский текст читается или квадраты.",
      font_used: "Noto Sans (jsDelivr CDN, Cyrillic) — дефолт из shotstack.ts",
    });
  } catch (e) {
    return NextResponse.json({ error: "smoke-тест Shotstack упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
