import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { geminiText, hasGemini } from "@/lib/llm/gemini";
import { CONTENT_STANDARD, QA_THRESHOLD } from "@/lib/factory/standard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYS = "Ты топ-маркетолог UGC-видео для Wildberries/Ozon. Пишешь сценарии коротких вертикальных видео (Reels/Shorts/TikTok) под охват И переходы на карточку. Хук в 1-3 сек называет боль/возражение в лоб. Живой UGC, не реклама. В конце мягкий призыв искать товар на WB по точному названию/артикулу. " +
  "Верни СТРОГО JSON-массив: [{\"hook\":\"...\",\"angle\":\"какое возражение\",\"script\":\"сценарий 15-30 сек по кадрам\",\"caption\":\"подпись\",\"hashtags\":[\"...\"],\"format\":\"unboxing|POV|обзор|до/после|лайфхак|проблема-решение\",\"cta\":\"...\"}]. Только JSON.";

function parseArr(txt: string): unknown[] {
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

// Копирайтер: ансамбль Claude + Gemini → пул сценариев → QA-судья по стандарту (брак → на переделку).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const count = Math.min(12, Math.max(2, Number(body.count) || 8));
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

  const per = hasGemini() ? Math.ceil(count / 2) : count;
  const user = `Товар: ${subject}${article ? ` (артикул ${article})` : ""}. Сделай ${per} РАЗНЫХ сценариев — разные хуки/форматы/углы.` +
    (brief ? ` Бриф: ${brief}.` : "") + (competitorBrief ? ` Разведка конкурентов: ${competitorBrief}.` : "") + ` Стандарт качества, которому обязан соответствовать каждый: ${CONTENT_STANDARD}`;

  // 1) ансамбль: Claude + Gemini параллельно
  const [claudeRes, geminiRaw] = await Promise.all([
    client.messages.create({ model: MODEL, max_tokens: 3500, system: SYS, messages: [{ role: "user", content: user }] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r) => (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ")).catch(() => ""),
    hasGemini() ? geminiText(SYS, user, 3500) : Promise.resolve(null),
  ]);

  let pool = [
    ...parseArr(claudeRes).map((s) => ({ ...(s as object), source: "claude" })),
    ...parseArr(geminiRaw || "").map((s) => ({ ...(s as object), source: "gemini" })),
  ] as Record<string, unknown>[];
  if (!pool.length) return NextResponse.json({ error: "агенты не вернули сценарии" }, { status: 502 });

  // 2) QA-судья: оценка по стандарту, брак → на переделку
  try {
    const list = pool.map((s, i) => `#${i}: hook="${s.hook}" | angle="${s.angle}" | format="${s.format}"`).join("\n");
    const jr = await client.messages.create({
      model: MODEL, max_tokens: 1500,
      system: `Ты QA-директор контент-завода. Оцени каждый сценарий по стандарту (1-10) и реши: проходит или на переделку. Стандарт: ${CONTENT_STANDARD}\nВерни СТРОГО JSON-массив: [{"i":0,"score":8,"verdict":"approved|rework","fix":"если rework — что исправить, кратко"}]. Только JSON.`,
      messages: [{ role: "user", content: list }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verdicts = parseArr((jr.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ")) as { i: number; score: number; verdict: string; fix?: string }[];
    const byI = new Map(verdicts.map((v) => [v.i, v]));
    pool = pool.map((s, i) => {
      const v = byI.get(i);
      const score = v?.score ?? 6;
      return { ...s, score, verdict: score >= QA_THRESHOLD ? "approved" : "rework", fix: score >= QA_THRESHOLD ? "" : (v?.fix || "усилить хук/аутентичность") };
    });
  } catch { /* без оценки — отдаём как есть */ }

  pool.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const approved = pool.filter((s) => s.verdict !== "rework");
  return NextResponse.json({
    article, product: subject, count: pool.length,
    approved_count: approved.length, rework_count: pool.length - approved.length,
    ensemble: hasGemini() ? "claude+gemini" : "claude",
    scripts: pool,
  });
}
