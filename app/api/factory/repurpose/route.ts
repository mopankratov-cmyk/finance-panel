import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { DEAI_FILTERS } from "@/lib/factory/standard";
import { extractJsonArray } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

// «Размножение»: одна идея/сценарий → готовые текстовые посты под разные площадки.
const PLATFORM_RULES: Record<string, string> = {
  Telegram: "короткий пост 300-600 знаков, живой тон, 1-2 эмодзи, без хэштегов-простыней, мягкий CTA искать товар на WB",
  "Дзен": "статья-история 1500-2500 знаков, цепляющий заголовок, подзаголовки, личный опыт, в конце ссылка-призыв на WB",
  VK: "пост 400-800 знаков, по-человечески, 3-5 хэштегов, призыв в комментариях/сообщении",
  Instagram: "подпись к посту/Reels 500-900 знаков, первая строка-хук, эмодзи по смыслу, 8-12 хэштегов, CTA в шапку/поиск WB",
  "Threads": "короткий тред 2-4 абзаца, разговорно, без хэштег-простыней",
};

export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const idea: string = (body.idea || body.hook || body.concept || "").toString().trim();
  const script: string = (body.script || "").toString().trim();
  const product: string = (body.product || body.sku_art || "").toString().trim();
  const profile: string = (body.profile || "").toString().trim().slice(0, 2000);
  const platforms: string[] = Array.isArray(body.platforms) && body.platforms.length
    ? body.platforms.filter((p: string) => PLATFORM_RULES[p])
    : ["Telegram", "Дзен", "VK", "Instagram"];
  if (!idea && !script) return NextResponse.json({ error: "Нужна идея/хук или сценарий" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const rules = platforms.map((p) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");
  const sys = `Ты SMM-редактор. Из ОДНОЙ идеи/сценария делаешь РАЗНЫЕ посты под площадки — у каждой свой формат, длина и тон (не копипаста!).
${profile ? `ПРОФИЛЬ БРЕНДА/АУДИТОРИИ (пиши в этом голосе, под эту ЦА):\n${profile}\n` : ""}
${DEAI_FILTERS}
ПЛОЩАДКИ:
${rules}
Верни СТРОГО JSON-массив: [{"platform":"Telegram","title":"если есть","text":"готовый пост","hashtags":["..."]}]. Только JSON, без преамбулы.`;
  const user = `Товар: ${product || "—"}. Идея/хук: «${idea}».${script ? ` Сценарий/суть: ${script.slice(0, 800)}.` : ""} Сделай посты под: ${platforms.join(", ")}.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2500, system: sys, messages: [{ role: "user", content: user }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const posts = extractJsonArray(txt);
    if (!posts?.length) return NextResponse.json({ error: "пустой ответ" }, { status: 502 });
    return NextResponse.json({ product, posts });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
  } catch (e) {
    return NextResponse.json({
      product: "",
      posts: [],
      error: "перепаковка ролика упала: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
