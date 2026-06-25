import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { learningHints } from "@/lib/factory/learningHints";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// §13 V3 Decomposer-агент: видео конкурента → типизированный нод-граф (каркас для «перенести себе»).
// ⚠️ ДЕ-РИСК (2026-06-20): Virlo analyze_video отдаёт ТОЛЬКО статистику (percentile/outlier), НЕ покадровую
// структуру, и стоит $0.50 → beat_structure из Virlo недоступен. Раскладываем из ОПИСАНИЯ (Virlo его отдаёт,
// у виральных видео caption описывает весь питч) + hook + format через Claude. Позже — vision-разбор кадров.
// GET/POST { viral_video_id? | niche? | description?+hook?+format? }:
//   - viral_video_id → caption/hook/format из viral_videos
//   - niche          → топ-видео ниши по virality_score
//   - description    → разложить произвольный текст-описание (ручной ввод)
// Выход: { ok, format, nodes[], confidence, source_url } | { error }. Весь обработчик в try/catch → ВСЕГДА JSON.

const MODEL = "claude-sonnet-4-6";

const NODE_TYPES = "hook_ugc|ai_product_render|talking_head|prank|before_after|pov|b_roll|captions|sound|music|carousel_slide|static_post|voiceover";
const TOOLS = "seedance|kling|creatify|shotstack|disk_real|sound|elevenlabs";
const FORMATS = "ugc_anim|ai_render|prank|talking_head|before_after|pov|unboxing|reaction|problem_solution|carousel|static";

// толерантный парсер JSON-объекта (переживает обрезку/ограждение)
// extractJson вынесен в @/lib/factory/extractJson (общий с produce/scenario)

async function decompose(params: { viral_video_id?: string; niche?: string; description?: string; hook?: string; format?: string; video_url?: string }) {
  const db = getSupabaseAdmin();
  let desc = (params.description || "").trim();
  let hook = (params.hook || "").trim();
  let fmt = (params.format || "").trim();
  let niche = (params.niche || "").trim();
  let url = (params.video_url || "").trim();

  // источник: viral_video_id → описание/хук/формат из корпуса
  if (params.viral_video_id && db) {
    const { data } = await db.from("viral_videos").select("url,niche,caption,hook_text,format_detected").eq("id", params.viral_video_id).limit(1);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (row) { url = url || String(row.url || ""); niche = niche || String(row.niche || ""); desc = desc || String(row.caption || ""); hook = hook || String(row.hook_text || ""); fmt = fmt || String(row.format_detected || ""); }
  }
  // источник: niche → топ-видео ниши
  if (!desc && niche && db) {
    const { data } = await db.from("viral_videos").select("url,niche,caption,hook_text,format_detected,virality_score").eq("niche", niche).not("caption", "is", null).order("virality_score", { ascending: false, nullsFirst: false }).limit(1);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (row) { url = String(row.url || ""); niche = String(row.niche || niche); desc = String(row.caption || ""); hook = String(row.hook_text || ""); fmt = String(row.format_detected || ""); }
  }

  if (!desc) return { error: "нужно описание видео: viral_video_id, niche (с корпусом) или description напрямую" };

  const client = await createClaudeClient();
  if (!client) return { error: "ANTHROPIC_API_KEY не настроен" };

  const sys = `Ты сценарист-декомпозитор контент-завода для карточек WB/Ozon. На входе — описание/подпись РЕАЛЬНОГО
залетевшего короткого видео конкурента (TikTok/Reels). Восстанови его вероятную ПОКАДРОВУЮ структуру и разложи на
типизированные КИРПИЧИКИ-НОДЫ, из которых владелец потом пересоберёт похожее под СВОЙ товар. Думай о СТРУКТУРЕ и
РОЛЯХ кадров (хук 0-3с → проблема → решение/демо → доказательство → CTA), смене кадра каждые 1.5-2.5с.
Для КАЖДОЙ ноды: node_type (${NODE_TYPES}), role (hook|problem|solution|proof|cta), и tool_candidate — каким нашим
инструментом её воспроизвести (${TOOLS}).
ГЛАВНОЕ ПРАВИЛО РОУТИНГА — РЕАЛЬНАЯ СЪЁМКА = ХРЕБЕТ, AI = ТОЛЬКО АКЦЕНТ (иначе «пахнет рекламой» и AI-слоп):
- По умолчанию роли problem|solution|proof → disk_real (реальный клип/фото модели с товаром). Это база ролика.
- seedance (i2v от РЕАЛЬНОГО фото) — для hook-ревила и динамики, КОГДА реальной съёмки под кадр нет.
- creatify (актёр-липсинк под СВОЮ озвучку, не TTS) — только говорящая голова / UGC-отзыв. Взрослые персоны.
- до/после два состояния → before_after + seedance(end_image); текст на экране → shotstack(captions);
  трендовый звук → sound/music; статик/карусель собираются отдельным экраном, не через video-граф.
НЕ ставь creatify/seedance в каждую вторую ноду — это слоп. Если кадр можно снять реально → disk_real.
- ЗАКАДР: если формат — голос ПОВЕРХ реальной съёмки/b-roll (а НЕ говорящая голова), добавь ОДНУ ноду
  node_type=voiceover, tool_candidate=elevenlabs, role=cta; в её поле voiceover склей ВЕСЬ текст закадра по сценам.
  ElevenLabs озвучит русским → ляжет аудио-дорожкой поверх видео. Сильный анти-слоп (живое видео + проф. голос).
Верни СТРОГО JSON без преамбулы:
{ "format": "(${FORMATS})",
  "nodes": [ { "ordinal":1, "node_type":"...", "role":"...", "duration_sec":2.5, "hook_type":"...",
    "onscreen_text":"текст на экране по-русски", "voiceover":"озвучка по-русски", "emotion":"shock|curiosity|calm|flex",
    "visual_desc":"коротко что в кадре", "tool_candidate":"..." } ],
  "confidence": "high|med|low" }
Тайминг реалистичный (ролик 15-30с). 4-7 нод. Тексты по-русски. Только JSON.`;

  // V7/R6 · петля обучения: грундим декомпозицию накопленным сигналом ниши (победители/корпус/анти-паттерны)
  const lh = db ? await learningHints(db, niche) : "";
  const user = `Ниша: ${niche || "?"}\nХук (если известен): ${hook || "?"}\nФормат-детект: ${fmt || "?"}\n` +
    `ОПИСАНИЕ видео конкурента (его подпись/питч):\n${desc.slice(0, 2500)}\nВосстанови структуру и разложи на ноды.${lh}`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: user }] });
    const txt = (res.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text || "").join(" ");
    const parsed = extractJson(txt);
    if (!parsed || !Array.isArray(parsed.nodes) || !parsed.nodes.length) return { error: "декомпозитор не вернул ноды", raw: txt.slice(0, 200) };
    const format = parsed.format || fmt || "ugc_anim";
    const confidence = parsed.confidence || "med";
    // сохраняем каркас в node_templates → можно «перенести себе» по template_id
    let template_id: number | null = null;
    if (db) {
      try {
        const svid = params.viral_video_id && /^\d+$/.test(params.viral_video_id) ? Number(params.viral_video_id) : null;
        const { data: t } = await db.from("node_templates").insert({ source_video_url: url || null, source_viral_video_id: svid, format_type: format, niche, nodes: parsed.nodes, confidence }).select("id").limit(1);
        template_id = (t as { id: number }[] | null)?.[0]?.id ?? null;
      } catch { /* node_templates не применена — каркас всё равно вернём */ }
    }
    return { ok: true, format, nodes: parsed.nodes, confidence, source_url: url, niche, from: "description", template_id };
  } catch (e) {
    return { error: "claude decompose: " + String((e as Error)?.message || e).slice(0, 160) };
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const r = await decompose({ viral_video_id: sp.get("viral_video_id") || undefined, niche: sp.get("niche") || undefined, description: sp.get("description") || undefined });
    return NextResponse.json(r, { status: (r as { error?: string }).error ? 400 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "decompose crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await decompose({ viral_video_id: body.viral_video_id, niche: body.niche, description: body.description, hook: body.hook, format: body.format });
    return NextResponse.json(r, { status: (r as { error?: string }).error ? 400 : 200 });
  } catch (e) {
    return NextResponse.json({ error: "decompose crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
