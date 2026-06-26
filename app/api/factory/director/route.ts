import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Агент «Директор маркетинга» — оркестратор. Получает ТЗ от владельца, декомпозирует и
// раздаёт задачи спец-агентам. Возвращает план «кому что делать» (на утверждение → потом исполнение).
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const task: string = (body.task || "").toString().trim();
  const profile: string = (body.profile || "").toString().trim().slice(0, 2000);
  if (!task) return NextResponse.json({ error: "Нужно ТЗ (задача)" }, { status: 400 });

  // товары + ДЕТЕРМИНИРОВАННОЕ извлечение явного артикула из текста задачи
  let topProducts = "";
  let explicitArt = "";
  let explicitName = "";
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const { data } = await db.from("product_costs").select("article, name");
      const prods = (data as { article: string; name: string }[] | null) ?? [];
      const taskU = task.toUpperCase();
      // 1) известный артикул, упомянутый в задаче (берём самое длинное совпадение)
      for (const p of prods) {
        const a = String(p.article || "").toUpperCase();
        if (a.length >= 4 && taskU.includes(a) && a.length > explicitArt.length) { explicitArt = p.article; explicitName = p.name; }
      }
      // 2) если среди известных не нашли — вытащим токен, похожий на артикул
      if (!explicitArt) { const m = task.match(/\b[A-Za-z]{2,}\d{3,}[A-Za-z\d]*\b|\b\d{6,}\b/); if (m) explicitArt = m[0]; }
      // список для Claude: явный товар первым, затем ещё до 40
      const head = explicitArt && explicitName ? [`${explicitArt} — ${explicitName} ⟵ назван в задаче`] : [];
      const rest = prods.filter((c) => c.article !== explicitArt).slice(0, 40).map((c) => `${c.article} — ${c.name}`);
      topProducts = [...head, ...rest].join("; ");
    }
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
${profile ? `\nПРОФИЛЬ БРЕНДА/АУДИТОРИИ (учитывай при постановке задач):\n${profile}\n` : ""}
Доступные товары (артикул — название): ${topProducts || "нет данных, спроси/уточни артикул"}
ВАЖНО: если в задаче явно назван артикул товара — используй ЕГО ТОЧНО в target_article, не заменяй похожим.${explicitArt ? ` В этой задаче назван артикул: ${explicitArt}.` : ""}

План — максимум 6 шагов, формулировки КОРОТКИЕ (action ≤12 слов, why ≤8 слов, params минимальны). Верни СТРОГО валидный компактный JSON: {"goal":"цель 1 предложением","target_article":"артикул или ''","plan":[{"order":1,"agent":"Аналитик","action":"кратко","params":{},"why":"кратко"}],"clarify":"что уточнить или ''","summary":"резюме 1-2 предложения"}. Только JSON, без преамбулы, без markdown.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2500, system: sys, messages: [{ role: "user", content: task }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const plan = extractJson(txt);
    if (!plan) return NextResponse.json({ error: "пустой план", raw: txt.slice(0, 200) }, { status: 502 });
    // явный артикул из задачи всегда побеждает догадку модели
    if (explicitArt) plan.target_article = explicitArt;
    return NextResponse.json(plan);
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
  } catch (e) {
    return NextResponse.json({
      error: "директор завода упал: " + String((e as Error)?.message || e).slice(0, 160),
      goal: "",
      target_article: "",
      plan: [],
      clarify: "director endpoint crashed; inspect backend logs",
      summary: "",
    }, { status: 500 });
  }
}
