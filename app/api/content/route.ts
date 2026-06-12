import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import type { Anthropic } from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ContentProduct {
  article: string;
  name: string | null;
  nmId: number | null;
}

const SYSTEM = `Ты — копирайтер карточек товаров Wildberries. Пишешь продающие, SEO-оптимизированные тексты на русском языке, которые повышают CTR и конверсию в корзину.

Правила:
- Заголовок до 60 символов, с ключевым запросом в начале, без воды и КАПСА.
- Описание 400–800 символов: выгоды для покупателя, сценарии использования, ключевые характеристики, мягкий призыв.
- Ключевые слова — релевантные поисковые запросы (15–25 штук), по убыванию частотности.
- A/B-варианты заголовка — 3 разных угла подачи (выгода / эмоция / характеристика), каждый со своей гипотезой.
Опирайся на данные воронки, если они даны: низкий CV корзины → усиль заголовок и первый экран; низкий % выкупа → уточни ожидания в описании.`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    description: { type: "string" as const },
    keywords: { type: "array" as const, items: { type: "string" as const } },
    variants: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          label: { type: "string" as const, description: "угол: выгода | эмоция | характеристика" },
          title: { type: "string" as const },
          rationale: { type: "string" as const, description: "гипотеза, почему сработает" },
        },
        required: ["label", "title", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "description", "keywords", "variants"],
  additionalProperties: false,
};

// Список товаров для выбора
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const [costsRes, ordersRes] = await Promise.all([
    db.from("product_costs").select("article, name"),
    db
      .from("wb_orders")
      .select("nm_id, supplier_article")
      .not("supplier_article", "is", null)
      .limit(1000),
  ]);
  if (costsRes.error) return NextResponse.json({ data: null, error: costsRes.error.message }, { status: 500 });

  const articleToNm = new Map<string, number>();
  for (const r of ordersRes.data ?? []) {
    if (!articleToNm.has(r.supplier_article)) articleToNm.set(r.supplier_article, r.nm_id);
  }
  const data: ContentProduct[] = (costsRes.data ?? []).map((c) => ({
    article: c.article as string,
    name: (c.name as string) ?? null,
    nmId: articleToNm.get(c.article as string) ?? null,
  }));
  data.sort((a, b) => a.article.localeCompare(b.article));
  return NextResponse.json({ data, error: null });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const article: string = typeof body.article === "string" ? body.article : "";
  const name: string = typeof body.name === "string" ? body.name : "";
  const nmId: number | null = typeof body.nmId === "number" ? body.nmId : null;
  if (!article && !name) {
    return NextResponse.json({ error: "Не указан товар" }, { status: 400 });
  }

  const client = await createClaudeClient();
  if (!client) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });
  }

  // контекст воронки за 7 дней, если есть nm_id
  let funnel: Record<string, number> | null = null;
  const db = getSupabaseAdmin();
  if (db && nmId) {
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const { data } = await db
      .from("wb_funnel_daily")
      .select("open_card, add_to_cart, orders, buyouts")
      .eq("nm_id", nmId)
      .gte("date", weekAgo);
    if (data && data.length) {
      const sum = (k: string) => data.reduce((s, r) => s + Number((r as Record<string, number>)[k] ?? 0), 0);
      const open = sum("open_card");
      const cart = sum("add_to_cart");
      const ord = sum("orders");
      const buy = sum("buyouts");
      funnel = {
        openCard: open,
        cartRatePct: open > 0 ? Math.round((cart / open) * 1000) / 10 : 0,
        orderRatePct: cart > 0 ? Math.round((ord / cart) * 1000) / 10 : 0,
        buyoutRatePct: ord > 0 ? Math.round((buy / ord) * 1000) / 10 : 0,
      };
    }
  }

  try {
    const prompt = [
      `Товар: ${name || article} (артикул ${article}).`,
      funnel
        ? `Данные воронки за 7 дней: показы ${funnel.openCard}, CV корзина ${funnel.cartRatePct}%, CR заказ ${funnel.orderRatePct}%, % выкупа ${funnel.buyoutRatePct}%.`
        : "Данных воронки нет — пиши по названию товара.",
      "Сгенерируй карточку: заголовок, описание, ключевые слова и 3 A/B-варианта заголовка.",
    ].join("\n");

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text);
    return NextResponse.json({ content: parsed, funnel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
