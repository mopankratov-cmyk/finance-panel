import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CONTENT_STANDARD, QA_THRESHOLD } from "@/lib/factory/standard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Копирайтер: быстрый Sonnet, один вызов — генерит N сценариев И сам оценивает каждый по стандарту
// (self-QA: score/verdict/fix). Брак (< порога) → verdict "rework". Укладывается в лимит функции.
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const count = Math.min(10, Math.max(2, Number(body.count) || 5));
  const brief: string = (body.brief || "").toString().trim();
  const competitorBrief: string = (body.competitor_brief || "").toString().trim();

  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const subject = name || article;
  if (!subject) return NextResponse.json({ error: "Нужен артикул или название товара" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты топ-маркетолог UGC-видео для Wildberries/Ozon И строгий QA-директор. Пишешь сценарии коротких вертикальных видео (Reels/Shorts/TikTok) под охват И переходы на карточку, потом сам оцениваешь каждый по стандарту.
СТАНДАРТ: ${CONTENT_STANDARD}
Сделай разные хуки/форматы/углы. Это БЫСТРАЯ идеация — НЕ пиши покадровый сценарий, только идею. Полный сценарий развернём отдельно для выбранных. Для КАЖДОГО честно поставь score 1-10 по стандарту; если < ${QA_THRESHOLD} — verdict "rework" и в fix что исправить.
Верни СТРОГО JSON-массив (кратко): [{"hook":"первая фраза-зацепка","angle":"какое возражение","concept":"идея ролика 1-2 предложения","caption":"подпись","format":"unboxing|POV|обзор|до/после|лайфхак|проблема-решение","cta":"кратко","score":8,"verdict":"approved|rework","fix":""}]. Только JSON, без преамбулы.`;

  const user = `Товар: ${subject}${article ? ` (артикул ${article})` : ""}. Сделай ${count} сценариев.` +
    (brief ? ` Бриф: ${brief}.` : "") + (competitorBrief ? ` Разведка конкурентов: ${competitorBrief}.` : "");

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2200, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "пустой ответ", raw: txt.slice(0, 200) }, { status: 502 });
    let scripts: Record<string, unknown>[] = [];
    try { scripts = JSON.parse(m[0]); } catch { return NextResponse.json({ error: "невалидный JSON от агента" }, { status: 502 }); }
    // нормализация verdict по порогу
    scripts = scripts.map((s) => { const sc = Number(s.score) || 6; return { ...s, score: sc, verdict: sc >= QA_THRESHOLD ? "approved" : "rework", fix: sc >= QA_THRESHOLD ? "" : (s.fix || "усилить хук/аутентичность") }; });
    scripts.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const approved = scripts.filter((s) => s.verdict !== "rework").length;
    return NextResponse.json({ article, product: subject, count: scripts.length, approved_count: approved, rework_count: scripts.length - approved, ensemble: "claude-sonnet (self-QA)", scripts });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
