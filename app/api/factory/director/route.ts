import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Агент «Директор маркетинга» — оркестратор. Получает ТЗ от владельца, декомпозирует и
// раздаёт задачи спец-агентам. Возвращает план «кому что делать» (на утверждение → потом исполнение).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const task: string = (body.task || "").toString().trim();
  if (!task) return NextResponse.json({ error: "Нужно ТЗ (задача)" }, { status: 400 });

  // лёгкий контекст: топ-товары (ABC) — чтобы директор приоритизировал по факту
  let topProducts = "";
  try {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("article, name").limit(40); if (data?.length) topProducts = data.slice(0, 40).map((c) => `${c.article} — ${c.name}`).join("; "); }
  } catch { /* контекст не критичен */ }

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты — Директор по маркетингу контент-завода для селлера WB/Ozon. Получаешь ТЗ от владельца и раздаёшь работу команде AI-агентов. Цель: максимум охватов И переходов на карточки товаров.

Команда и что умеет (назначай задачи ТОЛЬКО этим агентам):
- Аналитик — разведка конкурентов (топ-карточки WB) и трендов; даёт бриф. [endpoint: /api/lab/competitors]
- Копирайтер — N UGC-сценариев с хуками под возражения. [endpoint: /api/factory/scripts]
- Дизайнер — фото/карточки (Higgsfield/fal). [endpoint: /api/lab/image-generate]
- Видеограф — видео + нарезка в шортсы. [endpoint: /api/lab/video-storyboard]
- SMM-менеджер — постинг и расписание по площадкам. [пока в разработке]
- Трафик-аналитик — UTM/промокоды, отбор хуков-победителей. [пока в разработке]

Принципы: приоритизируй товары класса A; начинай с разведки конкурентов перед креативом; мерь результат в маркетплейсе (брендовый поиск/продажи), не per-video; объём важнее единичного качества (виральность — игра вариативности).

Доступные товары (артикул — название): ${topProducts || "нет данных, спроси/уточни артикул"}

Верни СТРОГО JSON: {"goal":"цель одним предложением","target_article":"артикул если ясно или ''","plan":[{"order":1,"agent":"Аналитик","action":"что сделать","params":{"...":"..."},"why":"зачем"}],"clarify":"что уточнить у владельца, если ТЗ неполное, иначе ''","summary":"короткое резюме плана для владельца"}. Без преамбулы.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1500, system: sys, messages: [{ role: "user", content: task }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустой план", raw: txt.slice(0, 200) }, { status: 502 });
    return NextResponse.json(JSON.parse(m[0]));
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
