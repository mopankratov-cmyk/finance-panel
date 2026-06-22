import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { gatherAgentContext } from "@/lib/agent/gatherContext";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `Ты — аналитик маркетплейс-бизнеса на Wildberries. Тебе дают компактный срез данных по SKU: темп заказов, остатки, оборачиваемость, расход рекламы и ДРР.

Твоя задача — находить аномалии и давать конкретные рекомендации на русском языке. Ориентиры (бенчмарки):
- ДРР > 20% — реклама убыточна (critical при > 30%, warning при 20–30%).
- Остаток кончится менее чем за 14 дней (daysLeft < 14) — риск out-of-stock (critical если daysLeft <= 7).
- Оборачиваемость > 60 дней или «деньги в остатках» велики при низком темпе — замороженный капитал (warning).
- Резкое падение заказов день-к-дню (ordersToday намного ниже ordersYesterday у крупных SKU) — warning.

Пиши кратко и по делу. Каждый инсайт — про конкретный артикул или общий вывод. Не выдумывай данные, которых нет.`;

const INSIGHTS_SCHEMA = {
  type: "object" as const,
  properties: {
    insights: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          severity: { type: "string" as const, enum: ["info", "warning", "critical"] },
          module: { type: "string" as const, description: "ads | supplies | finance | analytics" },
          title: { type: "string" as const, description: "короткий заголовок" },
          body: { type: "string" as const, description: "1–3 предложения с рекомендацией" },
        },
        required: ["severity", "module", "title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
};

interface Insight {
  severity: string;
  module: string;
  title: string;
  body: string;
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => ({}));
  const mode: "analyze" | "chat" = body.mode === "chat" ? "chat" : "analyze";
  const question: string = typeof body.question === "string" ? body.question : "";

  const client = await createClaudeClient();
  if (!client) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });
  }

  try {
    const context = await gatherAgentContext(cabinetIdFromParam(typeof body.cabinet === "string" ? body.cabinet : null));
    const contextJson = JSON.stringify(context);

    if (mode === "chat") {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Данные по бизнесу (JSON):\n${contextJson}\n\nВопрос: ${question || "Дай краткий разбор ситуации."}`,
          },
        ],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return NextResponse.json({ answer: text });
    }

    // analyze: структурированные инсайты
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: INSIGHTS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Проанализируй данные и верни список инсайтов (аномалии и рекомендации). Данные (JSON):\n${contextJson}`,
        },
      ],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let insights: Insight[] = [];
    try {
      insights = (JSON.parse(text).insights ?? []) as Insight[];
    } catch {
      return NextResponse.json({ error: "Не удалось разобрать ответ модели" }, { status: 502 });
    }

    // сохраняем в agent_insights
    const db = getSupabaseAdmin();
    if (db && insights.length) {
      await db
        .from("agent_insights")
        .insert(
          insights.map((i) => ({
            module: i.module,
            severity: i.severity,
            title: i.title,
            body: i.body,
            data: null,
          })),
        );
    }

    return NextResponse.json({ insights, count: insights.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
