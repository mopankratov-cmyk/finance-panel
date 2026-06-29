import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "@/lib/factory/extractJson";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateBlueprint } from "@/lib/factory/blueprint/schema";
import { buildFallbackUgcScript, normalizeUgcScript } from "@/lib/factory/ugcScript";
import { checkPersonaConsent } from "@/lib/factory/ugcJobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

function text(value: unknown, max = 1000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function firstHook(body: Record<string, unknown>): string {
  const direct = text(body.hook || body.hook_text || body.concept, 180);
  if (direct) return direct;
  const scenario = body.scenario && typeof body.scenario === "object" ? body.scenario as Record<string, unknown> : null;
  const shots = Array.isArray(scenario?.shots) ? scenario?.shots as Record<string, unknown>[] : [];
  return text(shots[0]?.voiceover || shots[0]?.onscreen || scenario?.title, 180);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const hook = firstHook(body);
    if (!hook) return NextResponse.json({ ok: false, error: "Нужен locked hook для UGC-script" }, { status: 400 });

    const article = text(body.article || body.sku_art, 80);
    const product = text(body.product_name || body.product || body.brief || article, 180);
    const personaRef = text(body.persona_id || body.avatar || body.creator, 120) || null;
    const db = getSupabaseAdmin();
    const warnings: string[] = [];

    const personaGate = await checkPersonaConsent(db, personaRef);
    if (personaGate.warning) warnings.push(personaGate.warning);
    const personaId = personaGate.personaId || personaRef;
    const consentStatus = personaGate.consentStatus || (personaRef ? "unknown" : null);

    const blueprintRaw = body.blueprint && typeof body.blueprint === "object" ? body.blueprint : null;
    const blueprint = blueprintRaw ? validateBlueprint(blueprintRaw) : null;
    const blueprintErrors = blueprint && !blueprint.ok ? blueprint.errors : [];

    const fallback = (reason: string) => {
      const script = buildFallbackUgcScript({ hook, product, personaId, consentStatus, reason });
      if (blueprintErrors.length) script.render_blockers.push(...blueprintErrors.map((e) => `blueprint: ${e}`));
      script.render_allowed = script.render_blockers.length === 0;
      return NextResponse.json({
        ok: true,
        source: "fallback",
        article,
        valid: true,
        warnings: [...warnings, reason],
        blueprint_valid: blueprint ? blueprint.ok : null,
        blueprint_errors: blueprintErrors,
        script,
        render_allowed: script.render_allowed,
        render_blockers: script.render_blockers,
      });
    };

    const client = await createClaudeClient();
    if (!client) return fallback("ANTHROPIC_API_KEY не настроен");

    const system = `Ты пишешь UGC-реплику для короткого вертикального ролика WB/Ozon. Верни СТРОГО JSON без markdown.
Контракт:
{"hook":{"text":"ТОЧНО исходный хук","locked":true},"product":"название товара","duration_sec":15,"spoken_lines":[{"t":0,"text":"ТОЧНО исходный хук","emotion":"curious","delivery":"confessional|demo|whisper|matter_of_fact|excited","pause_after_ms":200}],"onscreen":[{"t":0,"text":"короткий текст"}],"cta":"мягкий CTA","notes":["коротко"]}
Правила:
- hook.text и spoken_lines[0].text должны дословно совпадать с исходным хуком;
- 2-6 spoken_lines, живой русский язык, без рекламного диктора и без AI-сленга;
- каждая line имеет emotion, delivery, pause_after_ms;
- никаких обещаний результата, медицинских/юридических гарантий и фейковых отзывов.`;
    const user = `Исходный locked hook: ${hook}
Товар: ${product || article || "товар"}${article ? ` (арт. ${article})` : ""}
Персона/аватар: ${personaRef || "не задана"}
Blueprint valid: ${blueprint ? String(blueprint.ok) : "not provided"}${blueprintErrors.length ? `; errors: ${blueprintErrors.join("; ")}` : ""}
Сделай spoken UGC-script 12-25 секунд.`;

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1600,
      temperature: 0.3,
      system,
      messages: [{ role: "user", content: user }],
    });
    const rawText = (res.content as any[]).filter((block) => block.type === "text").map((block) => block.text).join(" ");
    const parsed = extractJson(rawText);
    if (!parsed) return fallback("ugc-script: Claude вернул невалидный JSON");

    const normalized = normalizeUgcScript(parsed, {
      expectedHook: hook,
      product,
      personaId,
      consentStatus,
      extraRenderBlockers: blueprintErrors.map((e) => `blueprint: ${e}`),
    });

    return NextResponse.json({
      ok: true,
      source: "claude",
      article,
      valid: normalized.valid,
      errors: normalized.errors,
      warnings: [...warnings, ...normalized.warnings],
      blueprint_valid: blueprint ? blueprint.ok : null,
      blueprint_errors: blueprintErrors,
      script: normalized.script,
      render_allowed: normalized.script.render_allowed,
      render_blockers: normalized.script.render_blockers,
    }, { status: normalized.valid ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "ugc-script crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
