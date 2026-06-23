import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { buildBRollSpec, type BRollSpecInput } from "@/lib/factory/brollSpec";
import { remotionSubmit, remotionStatus, remotionReady } from "@/lib/factory/remotionRender";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MODEL = "claude-sonnet-4-6";

// Агент-«монтажёр» b-роллов: на входе СЦЕНАРИЙ + одна строка-бриф. Агент сам читает сценарий, находит
// N самых сильных фраз под визуализацию (хук/боль/ирония/кульминация/цифра), назначает preset/accent/stat
// в нашем дизайн-каноне (docs/factory-broll-canon.md), затем рендерит чистую моушен-графику через Remotion-VM
// (композиция BRoll, БЕЗ медиа/fal → дёшево и без зависимости от баланса). Стиль фиксирован в каноне — не в промпте.
//
// POST { script, count?=3, brand?, accent?, durationSec?=4 }
//   → { ok, brolls:[{phrase, preset, spec, url?|id?|error?}], rendered, render_ready }
// Без REMOTION_RENDER_URL вернёт спеки без рендера (агентский выбор фраз всё равно полезен).

interface BrollPick { phrase: string; preset?: string; accent?: string; kicker?: string; stat?: { value: string; label: string } }

function parseJson(txt: string): { brolls?: BrollPick[] } | null {
  const t = txt.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t); } catch { /* try slice */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* nope */ } }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const script: string = (body.script || "").toString().trim();
  if (!script) return NextResponse.json({ error: "нужен script (сценарий ролика)" }, { status: 400 });
  const count = Math.max(1, Math.min(6, Number(body.count) || 3));
  const brand: string = (body.brand || body.kicker || "").toString().slice(0, 24);
  const accentHint: string = (body.accent || "").toString();
  const durationSec = Number(body.durationSec) || 4;

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  // 1) агент выбирает сильные фразы + назначает форму (стиль зафиксирован в каноне, не в промпте)
  const sys = `Ты — агент-монтажёр коротких видео. На входе СЦЕНАРИЙ ролика. Выбери ${count} САМЫХ СИЛЬНЫХ фраз под моушен-графику b-ролл (по 4 секунды): хук, боль, ирония, кульминация, цифра-доказательство. Не описывай картинку — выбери ФРАЗЫ и форму подачи.
Для каждой задай:
- phrase: короткая ударная фраза из/по мотиву сценария (≤7 слов, по-русски, без кавычек).
- preset: "stat" если во фразе есть число-доказательство (его покажем крупно моноширинным); "quote" для одной короткой ударной мысли (≤3 слова); иначе "cascade" (фраза каскадом по строкам).
- accent: один из orange|cyan|lime|violet. На весь ролик используй НЕ БОЛЕЕ 2-3 разных акцентов (держи единый стиль).
- kicker: опц. мелкая верхняя плашка ≤2 слова (бренд/рубрика).
- stat: ТОЛЬКО для preset=stat → {"value":"8 часов","label":"экономит в неделю"}.
Стиль готового ролла: тёмный графит + акцент, плавно, динамично, лаконично. Верни СТРОГО JSON: {"brolls":[{"phrase":"...","preset":"...","accent":"...","kicker":"...","stat":{"value":"...","label":"..."}}]}. Только JSON.`;
  const user = `Бренд/рубрика: ${brand || "—"}. Желаемый акцент: ${accentHint || "на твой вкус (1-2 цвета)"}.\nСЦЕНАРИЙ:\n${script.slice(0, 6000)}`;

  let picks: BrollPick[] = [];
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1500, temperature: 0.5, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const j = parseJson(txt);
    picks = Array.isArray(j?.brolls) ? j!.brolls!.slice(0, count) : [];
  } catch (e) {
    return NextResponse.json({ error: "Claude: " + String(e).slice(0, 150) }, { status: 502 });
  }
  if (!picks.length) return NextResponse.json({ error: "агент не выделил фраз — уточни сценарий" }, { status: 502 });

  // 2) нормализуем в валидные спеки BRoll (детерминированно)
  const specs = picks.map((p, i) => {
    const input: BRollSpecInput = {
      phrase: String(p.phrase || "").slice(0, 80),
      preset: (["cascade", "quote", "stat"].includes(String(p.preset)) ? p.preset : undefined) as BRollSpecInput["preset"],
      accent: p.accent || accentHint || undefined,
      kicker: p.kicker || brand || undefined,
      stat: p.stat && p.stat.value ? { value: String(p.stat.value), label: String(p.stat.label || "") } : undefined,
      durationSec,
    };
    return { phrase: input.phrase, spec: buildBRollSpec(input, i) };
  }).filter((s) => s.phrase);

  // 3) рендер через Remotion-VM (если настроен). Параллельно сабмитим, затем опрашиваем в пределах бюджета.
  if (!remotionReady()) {
    return NextResponse.json({ ok: true, render_ready: false, rendered: 0, brolls: specs.map((s) => ({ ...s, error: "REMOTION_RENDER_URL не настроен — рендер b-роллов на VM не доступен (спеки готовы)" })) });
  }

  const submitted = await Promise.all(specs.map(async (s) => {
    const id = await remotionSubmit("BRoll", s.spec as unknown as Record<string, unknown>, s.spec.durationInFrames);
    return { ...s, id };
  }));

  const deadline = Date.now() + 230_000; // бюджет под maxDuration=300 (запас на заливку/ответ)
  const results = await Promise.all(submitted.map(async (s) => {
    if (!s.id) return { phrase: s.phrase, preset: s.spec.preset, spec: s.spec, error: "submit не прошёл (VM/ключ)" };
    // +19с = худшая итерация (status-таймаут 15с + sleep 4с) → не стартуем опрос, если перелезем за дедлайн
    while (Date.now() + 19_000 < deadline) {
      const st = await remotionStatus(s.id);
      if (st.status === "done" && st.videoUrl) return { phrase: s.phrase, preset: s.spec.preset, spec: s.spec, url: st.videoUrl };
      if (st.status === "error" && !st.retryable) return { phrase: s.phrase, preset: s.spec.preset, spec: s.spec, error: st.error };
      await new Promise((r) => setTimeout(r, 4000));
    }
    return { phrase: s.phrase, preset: s.spec.preset, spec: s.spec, id: s.id, error: "рендер не успел в бюджет — опроси по id позже" };
  }));

  return NextResponse.json({ ok: true, render_ready: true, rendered: results.filter((r) => r.url).length, brolls: results });
}
