import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Агент-Копирайтер: товар → N UGC-сценариев (хуки под возражения) для коротких видео.
// Первый кирпич системы генерации контент-завода.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const count = Math.min(15, Math.max(1, Number(body.count) || 8));
  const brief: string = (body.brief || "").toString().trim();
  const competitorBrief: string = (body.competitor_brief || "").toString().trim();

  // имя товара из product_costs, если дан артикул
  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const subject = name || article;
  if (!subject) return NextResponse.json({ error: "Нужен артикул или название товара" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = "Ты топ-маркетолог UGC-видео для Wildberries/Ozon. Пишешь сценарии коротких вертикальных видео (Reels/Shorts/TikTok), которые дают охват И гонят на карточку товара. " +
    "Хук в первые 1-3 секунды называет боль/возражение покупателя в лоб. Стиль — живой UGC (не реклама). В конце — мягкий призыв искать товар на WB по точному названию/артикулу (прямых ссылок в Reels нет). " +
    "Верни СТРОГО JSON-массив объектов: [{\"hook\":\"первая фраза-зацепка\",\"angle\":\"какое возражение/боль закрывает\",\"script\":\"полный сценарий 15-30 сек, по кадрам\",\"caption\":\"подпись под видео\",\"hashtags\":[\"...\"],\"format\":\"unboxing|POV|обзор|до/после|лайфхак|проблема-решение\",\"cta\":\"призыв\"}]. Без преамбулы, только JSON.";

  const user = `Товар: ${subject}${article ? ` (артикул ${article})` : ""}. Сделай ${count} РАЗНЫХ сценариев — разные хуки, форматы и углы.` +
    (brief ? ` Бриф: ${brief}.` : "") + (competitorBrief ? ` Учти разведку конкурентов: ${competitorBrief}.` : "");

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "пустой ответ", raw: txt.slice(0, 200) }, { status: 502 });
    const scripts = JSON.parse(m[0]);
    return NextResponse.json({ article, product: subject, count: scripts.length, scripts });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
