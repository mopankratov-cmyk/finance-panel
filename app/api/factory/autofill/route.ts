import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { TOOL_SCHEMAS, allToolKeys, type ToolField } from "@/lib/factory/toolSchemas";
import { normalizeParams } from "@/lib/factory/normalizeParams";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// §17 Ф1 · ИИ-автозаполнение графа (авто-режиссёр нод): один вызов Claude раскладывает ВЕСЬ граф —
// на каждую ноду выбирает движок (routing по доктрине «реальная съёмка=хребет, AI=акцент») + заполняет
// промпт и параметры. normalizeParams (Ф0) гарантирует валидность для API. Человек главнее: ноды с
// human_edited=true пропускаются (если не force). Шаг «auto» поверх готового «manual».
//   POST { recipe_id, node_ids?: number[], force?: boolean }

// терпимый парсер JSON от модели (снять ограждение, найти первый объект)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function looseJson(raw: string): any | null {
  let t = String(raw || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{"); if (s < 0) return null;
  t = t.slice(s);
  try { return JSON.parse(t); } catch { /* пробуем починить */ }
  try { return JSON.parse(t.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
}

// дайджест схемы инструмента для system-промпта: только api_param + values/default/hint (чтобы Claude заполнял валидно)
function toolDigest(tool: string): string {
  const sch = TOOL_SCHEMAS[tool]; if (!sch) return "";
  const fields: ToolField[] = [];
  for (const g of sch.groups) for (const f of g.fields) fields.push(f);
  const lines = fields.map((f) => {
    const bits: string[] = [f.api_param];
    if (f.values && f.values.length) bits.push(`{${f.values.slice(0, 12).join("|")}}`);
    else if (f.ui === "slider" || f.ui === "number") bits.push(`[${f.min ?? "?"}..${f.max ?? "?"}${f.step ? `/${f.step}` : ""}]`);
    else if (f.ui === "toggle") bits.push("bool");
    else bits.push(f.ui);
    if (f.default !== undefined) bits.push(`=${f.default}`);
    if (f.hint) bits.push(`// ${f.hint}`);
    return "  " + bits.join(" ");
  });
  return `${tool} (${sch.label}; типы: ${sch.node_types.join("/")}):\n${lines.join("\n")}`;
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const b = await req.json().catch(() => ({}));
    const recipeId = Number(b.recipe_id) || 0;
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });
    const force = !!b.force;
    const onlyIds: number[] = Array.isArray(b.node_ids) ? b.node_ids.map((x: unknown) => Number(x)).filter(Boolean) : [];

    // 1) рецепт + ноды
    const { data: recRows } = await db.from("node_recipes").select("id,article,niche,mode,format_detected,graph_doc").eq("id", recipeId).limit(1);
    const rec = (recRows as Record<string, unknown>[] | null)?.[0];
    if (!rec) return NextResponse.json({ ok: false, error: "рецепт не найден" }, { status: 404 });
    const { data: nodeRows } = await db.from("node_recipe_nodes").select("*").eq("recipe_id", recipeId).order("ordinal", { ascending: true });
    const allNodes = (nodeRows as Record<string, unknown>[] | null) || [];
    if (!allNodes.length) return NextResponse.json({ ok: false, error: "в графе нет нод" }, { status: 400 });

    const article = String(rec.article || "");
    const niche = String(rec.niche || nicheFromArticle(article, ""));
    const warnings: string[] = [];

    // целевые ноды: выбранные (node_ids) либо все; пропускаем ручные (если не force)
    const targets = allNodes.filter((n) => {
      if (onlyIds.length && !onlyIds.includes(Number(n.id))) return false;
      if (!force && n.human_edited === true) return false;
      return true;
    });
    const skipped = (onlyIds.length ? onlyIds.length : allNodes.length) - targets.length;
    if (!targets.length) return NextResponse.json({ ok: true, filled: 0, skipped, byTool: {}, warnings: ["все целевые ноды правлены вручную (force=false) — нечего заполнять"], nodes: [] });

    // 2) доступные движки (available !== false) — оффлайн (higgsfield/gemini/claude) не предлагаем
    const available = allToolKeys().filter((t) => TOOL_SCHEMAS[t]?.available !== false);
    const digests = available.map(toolDigest).filter(Boolean).join("\n\n");

    // 3) один batch-вызов Claude
    const client = await createClaudeClient();
    if (!client) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

    const sys = `Ты — авто-режиссёр контент-завода для карточек WB/Ozon. На входе граф нод одного короткого видео (Reels/TikTok). Для КАЖДОЙ ноды выбери НАШ движок и заполни его параметры + промпт так, чтобы сразу шло в сборку.
ДОКТРИНА РОУТИНГА — РЕАЛЬНАЯ СЪЁМКА = ХРЕБЕТ, AI = ТОЛЬКО АКЦЕНТ (иначе AI-слоп, «пахнет рекламой»):
- роли problem|solution|proof → по умолчанию disk_real (реальный клип/фото модели с товаром) — это база ролика.
- seedance (i2v от реального фото) — для hook-ревила и динамики, КОГДА реальной съёмки под кадр нет.
- kling — когда нужно жёстко держать форму/лого товара (i2v, тоже от фото).
- creatify — ТОЛЬКО говорящая голова / UGC-отзыв (актёр-липсинк), взрослые персоны.
- captions/титры → shotstack; трендовый звук → sound.
- НЕ ставь creatify/seedance в каждую вторую ноду. Если кадр можно снять реально → disk_real.
- ВАЖНО: has_real_asset=false НЕ значит «съёмки нет» — оператор прицепит реальный клип позже. Для ролей
  problem|solution|proof держи disk_real ПО УМОЛЧАНИЮ; seedance — только для hook-ревила/динамики или
  когда кадр физически нельзя снять. Уважай tool_candidate ноды (его выбрал декомпозитор по доктрине) —
  меняй движок только при явной причине, не AI-фай весь граф.
ДОСТУПНЫЕ ДВИЖКИ И ИХ ПОЛЯ (заполняй params ТОЛЬКО валидными значениями из наборов/диапазонов; vertical 9:16):
${digests}

Бренд/товар: ${brandProfile(article, "")}
Промпты движения — на английском, с preservation (товар не плывёт). onscreen_text/текст — на русском.
Верни СТРОГО JSON без преамбулы:
{ "assignments": [ { "ordinal": 1, "tool": "<один из: ${available.join("|")}>", "prompt": "промпт ноды", "params": { ... валидные поля движка ... }, "reason": "1 фраза почему этот движок" } ] }
Заполни ВСЕ ${targets.length} нод. params — объект полей выбранного движка (без выдуманных полей).`;

    const nodeLines = targets.map((n) => {
      const p = (n.params || {}) as Record<string, unknown>;
      return {
        ordinal: n.ordinal,
        node_type: n.node_type,
        role: p.role || n.slot,
        duration_sec: n.duration_sec,
        onscreen_text: (n.agent_suggestion as Record<string, unknown>)?.onscreen_text || p.onscreen_text || n.onscreen_text || null,
        voiceover: (n.agent_suggestion as Record<string, unknown>)?.voiceover || null,
        visual_desc: (n.agent_suggestion as Record<string, unknown>)?.visual_desc || p.visual_desc || null,
        tool_candidate: n.tool || (n.agent_suggestion as Record<string, unknown>)?.tool_candidate || null,
        has_real_asset: !!n.asset_url,
      };
    });
    const user = `Товар: ${article || "—"}. Ниша: ${niche}. Формат: ${rec.format_detected || "—"}.
Ноды графа (заполни каждую):
${JSON.stringify(nodeLines, null, 1).slice(0, 6000)}`;

    let assignments: Record<string, unknown>[] = [];
    try {
      const res = await client.messages.create({ model: MODEL, max_tokens: 4000, system: sys, messages: [{ role: "user", content: user }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = (res.content as any[]).filter((x) => x.type === "text").map((x) => x.text).join(" ");
      const j = looseJson(txt);
      assignments = Array.isArray(j?.assignments) ? j.assignments : [];
      if (!assignments.length) return NextResponse.json({ ok: false, error: "Claude не вернул assignments", raw: txt.slice(0, 160) }, { status: 502 });
    } catch (e) {
      return NextResponse.json({ ok: false, error: "Claude: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 502 });
    }

    // 4) пост-обработка + запись каждой ноды
    const byOrdinal = new Map(targets.map((n) => [Number(n.ordinal), n]));
    const byTool: Record<string, number> = {};
    const written: { node_id: number; tool: string; ordinal: number }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graphDoc = (rec.graph_doc && typeof rec.graph_doc === "object") ? rec.graph_doc as { nodes?: any[] } : null;

    for (const a of assignments) {
      const ord = Number(a.ordinal);
      const node = byOrdinal.get(ord);
      if (!node) continue;
      let tool = String(a.tool || "").trim();
      // движок недоступен/неизвестен → откат на кандидата ноды, иначе на disk_real
      if (!available.includes(tool)) {
        const cand = String(node.tool || "");
        const fallback = available.includes(cand) ? cand : "disk_real";
        warnings.push(`нода #${ord}: движок «${tool || "—"}» недоступен → ${fallback}`);
        tool = fallback;
      }
      // сохраняем мета-ключи ноды (role/onscreen_text/emotion/visual_desc) + params от Claude → нормализуем
      const meta = (node.params || {}) as Record<string, unknown>;
      const rawParams: Record<string, unknown> = { ...(a.params && typeof a.params === "object" ? a.params : {}) };
      for (const k of ["role", "onscreen_text", "emotion", "visual_desc"]) if (meta[k] !== undefined && rawParams[k] === undefined) rawParams[k] = meta[k];
      const norm = normalizeParams(tool, rawParams);
      // i2v без реального фото — маркер (Ф2 даунгрейдит/тянет фото; пока предупреждаем, нода всё равно валидна)
      if (norm.warnings.includes("needs_image") && !node.asset_url) warnings.push(`нода #${ord}: ${tool} нужен стартовый кадр (прицепи фото товара)`);
      for (const w of norm.warnings) if (w !== "needs_image") warnings.push(`нода #${ord}: ${w}`);

      const prompt = typeof a.prompt === "string" ? a.prompt.slice(0, 1500) : String(node.prompt || "");
      const patch: Record<string, unknown> = { tool, params: norm.params, prompt, source: "ai_autofilled", human_edited: false };
      if (typeof norm.params.duration_sec === "number") patch.duration_sec = norm.params.duration_sec;
      try {
        await db.from("node_recipe_nodes").update(patch).eq("id", node.id);
        byTool[tool] = (byTool[tool] || 0) + 1;
        written.push({ node_id: Number(node.id), tool, ordinal: ord });
        // graph_doc-синк (точки инструментов на канвасе)
        if (graphDoc?.nodes) { const gn = graphDoc.nodes.find((x) => String(x.id) === `n${ord}` || x.node_id === node.id); if (gn) { gn.tool = tool; gn.status = "configured"; } }
        // сигнал обучения
        try { await db.from("cf_signals").insert({ event: "node_autofilled", recipe_id: recipeId, node_id: node.id, slot: node.slot, tool, params: norm.params, niche, article: article || null, reason_chip: String(a.reason || "").slice(0, 80) || null }); } catch { /* журнал best-effort */ }
      } catch (e) { warnings.push(`нода #${ord}: не сохранилась (${String((e as Error)?.message || e).slice(0, 60)})`); }
    }

    if (graphDoc) { try { await db.from("node_recipes").update({ graph_doc: graphDoc, updated_at: new Date().toISOString() }).eq("id", recipeId); } catch { /* синк best-effort */ } }

    return NextResponse.json({ ok: true, filled: written.length, skipped, byTool, warnings, nodes: written });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "autofill crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
