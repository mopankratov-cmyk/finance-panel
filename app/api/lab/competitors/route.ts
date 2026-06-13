import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { wbSearch, normalizeClientProducts, type CompProduct } from "@/lib/wb/search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Разведка конкурентов перед генерацией: топ-карточки WB по запросу → анализ Claude vision →
// бриф (что норма / чего нет ни у кого / как отстроиться) + УТП + идеи заголовков.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query: string = (body.query || body.sku_name || "").toString().trim();
  // продукты: от клиента (браузерный поиск, не блокится) или серверный best-effort фолбэк
  let products: CompProduct[] = Array.isArray(body.products) && body.products.length
    ? normalizeClientProducts(body.products, 20)
    : query ? await wbSearch(query, 20) : [];
  products = products.slice(0, 20);
  if (!products.length) return NextResponse.json({ error: "Нет карточек конкурентов. Передай список от браузерного поиска WB или задай запрос.", products: [] }, { status: 200 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ products, analysis: null, error: "ANTHROPIC_API_KEY не настроен" });

  // до 10 карточек в Claude vision (токены)
  const imgs = products.slice(0, 10);
  const parts: ({ type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } })[] = [
    { type: "text", text: `Запрос «${query}». Ниже — топ-карточки конкурентов WB (главные фото). Проанализируй как маркетолог маркетплейса.` },
  ];
  for (const p of imgs) parts.push({ type: "image", source: { type: "url", url: p.img } });
  parts.push({ type: "text", text: 'Верни СТРОГО JSON: {"common":["что у большинства одинаково: ракурсы/фон/инфографика"],"gaps":["чего НЕТ ни у кого — шанс отстроиться"],"brief":"креативный бриф для генерации нашей карточки (1 абзац, на русском): какой стиль/фон/свет/композиция, чтобы попасть в категорию И выделиться","usps":["3-5 УТП-формулировок для плашек на карточке"],"title_ideas":["2-3 идеи заголовка"]}. Без преамбулы.' });

  try {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 900,
      system: "Ты ведущий маркетолог по карточкам Wildberries. Анализируешь визуал конкурентов и даёшь практичный бриф для отстройки. Отвечай только JSON.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: "user", content: parts as any }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    const analysis = m ? JSON.parse(m[0]) : null;
    return NextResponse.json({ query, products, analyzed: imgs.length, analysis });
  } catch (e) {
    return NextResponse.json({ query, products, analysis: null, error: String(e).slice(0, 150) });
  }
}
