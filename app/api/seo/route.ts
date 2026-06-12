import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import type { Anthropic } from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_CONTENT_TOKEN = process.env.WB_TOKEN_CONTENT;
const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";
const UPDATE_URL = "https://content-api.wildberries.ru/content/v2/cards/update";

const SUGGEST_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    description: { type: "string" as const },
    keywords: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["title", "description", "keywords"],
  additionalProperties: false,
};

const SYSTEM =
  "Ты — SEO-копирайтер карточек Wildberries. Улучшаешь заголовок (до 60 символов, ключевой запрос в начале) и описание (до 2000 символов, продающее, с релевантными ключами, без воды и КАПСА) на русском. Возвращаешь также 15–25 ключевых слов по убыванию частотности. Сохраняй суть товара.";

// Найти полную карточку по nmID (для сохранения всех полей при update)
async function fetchRawCard(nmId: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(CARDS_URL, {
    method: "POST",
    headers: { Authorization: WB_CONTENT_TOKEN!, "Content-Type": "application/json" },
    body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1, textSearch: String(nmId) } } }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { cards?: Record<string, unknown>[] };
  return (json.cards ?? []).find((c) => c.nmID === nmId) ?? null;
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const action: string = b.action === "apply" ? "apply" : "suggest";

  if (action === "suggest") {
    const client = await createClaudeClient();
    if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SUGGEST_SCHEMA } },
        messages: [
          {
            role: "user",
            content: `Товар: ${b.article ?? ""}.\nТекущий заголовок: ${b.title ?? ""}\nТекущее описание: ${b.description ?? ""}\n\nУлучши заголовок и описание для SEO, дай ключевые слова.`,
          },
        ],
      });
      const text = res.content.filter((x): x is Anthropic.TextBlock => x.type === "text").map((x) => x.text).join("");
      return NextResponse.json({ data: JSON.parse(text) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
    }
  }

  // apply — записать новый title/description, сохранив остальные поля карточки
  if (!WB_CONTENT_TOKEN) return NextResponse.json({ error: "WB_TOKEN_CONTENT не настроен" }, { status: 500 });
  const nmId: number | null = typeof b.nmId === "number" ? b.nmId : null;
  if (!nmId || !b.title) return NextResponse.json({ error: "Нужны nmId и title" }, { status: 400 });

  try {
    const card = await fetchRawCard(nmId);
    if (!card) return NextResponse.json({ error: "Карточка не найдена" }, { status: 404 });
    // round-trip: меняем только title/description, остальное оставляем как есть
    card.title = b.title;
    if (typeof b.description === "string") card.description = b.description;

    const res = await fetch(UPDATE_URL, {
      method: "POST",
      headers: { Authorization: WB_CONTENT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([card]),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return NextResponse.json({ error: `WB ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
