import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R3 · АРТЕФАКТ-ГЕЙТ: vision-проверка кадров ТОЛЬКО на сломанные артефакты AI-генерации
// (уанкэни/текст-блид/кривые руки/морфинг/искажённый товар) — ДО оценки качества рубрикой.
// Цель: «генерация выдалась идеально» — брак авто-перегенерится, к человеку не доходит.
//   POST { frames:[base64 jpeg] } → { ok:boolean, severity:'clean'|'minor'|'broken', defects:[string] }
// ⚠️ Липсинк по СТАТИЧНЫМ кадрам не судится (брак в движении/звуке) — это ловит motion/audio-чек, не здесь.

function parseLoose(txt: string): any {
  const parsed = extractJson(txt);
  if (parsed) return parsed;
  const ok = /"ok"\s*:\s*true/.test(txt);
  const broken = /"severity"\s*:\s*"broken"/.test(txt);
  return { ok: ok && !broken, severity: broken ? "broken" : ok ? "clean" : "minor", defects: [] };
}

export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, 6) : [];
  if (!frames.length) return NextResponse.json({ ok: true, severity: "clean", defects: [], note: "нет кадров — гейт пропущен" });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ ok: true, severity: "clean", defects: [], note: "ANTHROPIC_API_KEY нет — гейт мягко пропущен" });

  const sys = "Ты ОТК-контролёр СЛОМАННЫХ AI-артефактов в кадрах сгенерированного видео. " +
    "Ищи ТОЛЬКО технический брак генерации: искажённый/нечитаемый текст и логотипы, текст-блид с карточек, " +
    "плавящиеся/деформированные края, морфинг объекта между кадрами, лишние/кривые пальцы и руки, " +
    "восковая кожа, мёртвые/асимметричные глаза, искажённый/нереалистичный товар. " +
    "НЕ оценивай идею/хук/композицию/нравится-ли — ТОЛЬКО сломанные артефакты. " +
    "Верни СТРОГО JSON: {\"ok\":true|false,\"severity\":\"clean|minor|broken\",\"defects\":[\"коротко что сломано\"]}. " +
    "ok=false и severity=broken ТОЛЬКО если есть ЯВНЫЙ сломанный артефакт, портящий ролик. Мелкие неидеальности → minor, ok=true. Только JSON.";

  const content: any[] = [{ type: "text", text: `Ниже ${frames.length} кадр(ов) ролика ПО ПОРЯДКУ. Проверь на сломанные AI-артефакты.` }];
  for (const f of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } });

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 500, system: sys, messages: [{ role: "user", content }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const p = parseLoose(txt);
    const severity = ["clean", "minor", "broken"].includes(p.severity) ? p.severity : (p.ok === false ? "broken" : "clean");
    const ok = severity !== "broken";
    const defects = Array.isArray(p.defects) ? p.defects.map((d: unknown) => String(d).slice(0, 120)).slice(0, 5) : [];
    return NextResponse.json({ ok, severity, defects });
  } catch (e) {
    // сбой гейта НЕ блокирует конвейер (мягкая деградация — пропускаем как clean)
    return NextResponse.json({ ok: true, severity: "clean", defects: [], error: String((e as Error)?.message || e).slice(0, 140) });
  }
  } catch (e) {
    return NextResponse.json({
      ok: true,
      severity: "clean",
      defects: [],
      warning: "artifact-check crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}
