import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { TOOL_SCHEMAS, allToolKeys, type ToolField } from "@/lib/factory/toolSchemas";
import { normalizeParams } from "@/lib/factory/normalizeParams";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { collectBalances } from "@/lib/factory/balances";
import { learningHints } from "@/lib/factory/learningHints";
import { resolveBrandKit, applyKitToParams, brandKitPromptBlock } from "@/lib/factory/brandKit";

// Ф2 · tool → сервис баланса (бесплатные disk_real/sound не блокируются) и tool → примерная $-цена (зеркало TOOL_COST)
const TOOL_SERVICE: Record<string, string> = { seedance: "fal", seedance_fast: "fal", seedance_pro: "fal", kling: "fal", kling_pro: "fal", pika: "fal", creatify: "creatify" };
const TOOL_COST: Record<string, number> = { seedance: 0.42, seedance_fast: 0.14, seedance_pro: 0.42, kling: 0.38, kling_pro: 0.50, pika: 0.30, creatify: 1.20, shotstack: 0.08, disk_real: 0, disk: 0, sound: 0, music: 0, elevenlabs: 0.1 };

// Ф2 · грундинг-блок для system-промпта: обучение ниши + плейбук (render_role-роутинг) + наличие съёмки + баланс
function buildGrounding(niche: string, lh: string, playbook: Record<string, unknown> | null, footage: "real" | "photo" | "none", lowServices: string[]): string {
  const parts: string[] = [`ГРУНДИНГ НИШИ «${niche}» (реальные данные завода — учитывай в роутинге):`];
  if (lh && lh.trim()) parts.push(lh.trim());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fmts = (playbook && Array.isArray((playbook as any).winning_formats)) ? (playbook as any).winning_formats as Record<string, unknown>[] : [];
  if (fmts.length) {
    parts.push("ПЛЕЙБУК (реально залетающие форматы и роль AI-рендера):");
    parts.push(fmts.slice(0, 4).map((f) => {
      const rr = String(f.render_role || "нет");
      const rule = rr === "нет" ? "ЗАПРЕТ AI-видео целиком → disk_real" : (rr.includes("вставка") || rr === "обложка") ? "AI только одним кадром-вставкой/обложкой" : "AI ок, но disk_real дешевле если есть клип";
      return `• ${f.name} [engagement: ${f.engagement || "?"}; нужен человек: ${f.needs_human ? "да" : "нет"}; render_role: ${rr} → ${rule}]`;
    }).join("\n"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anti = (playbook as any).anti_patterns; if (Array.isArray(anti) && anti.length) parts.push(`АНТИ-ПАТТЕРНЫ ниши (не делай): ${anti.slice(0, 5).join("; ")}`);
  }
  parts.push(footage === "real"
    ? "РЕАЛЬНАЯ СЪЁМКА ПОД ТОВАР: ЕСТЬ на Я.Диске → для ролей problem|solution|proof ставь disk_real (это база, не AI)."
    : footage === "photo"
      ? "РЕАЛЬНОЙ СЪЁМКИ нет, но ЕСТЬ фото товара (WB-карточка) → seedance/kling i2v от этого фото допустим для динамики."
      : "НЕТ ни съёмки, ни фото на диске → i2v без стартового кадра не сработает; оператор прицепит ассет вручную.");
  if (lowServices.length) parts.push(`БЮДЖЕТ: низкий баланс ${lowServices.join("/")} → эти движки ИСКЛЮЧЕНЫ, роутинг на бесплатные (disk_real/sound).`);
  return "\n" + parts.join("\n") + "\n";
}

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

    // Ф2 · ГРУНДИНГ (всё параллельно, всё best-effort — autofill работает и без них):
    //   балансы (гард по деньгам) · обучение ниши · плейбук (render_role-роутинг) · наличие реальной съёмки
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [balances, lh, pbRow, diskRes, kit] = await Promise.all([
      collectBalances(db, { throttleMs: 60000 }).catch(() => [] as Record<string, unknown>[]),
      learningHints(db, niche).catch(() => ""),
      (async () => { try { const r = await db.from("niche_playbooks").select("playbook,updated_at").eq("niche", niche).order("updated_at", { ascending: false }).limit(1); return (r.data as Record<string, unknown>[] | null)?.[0] || null; } catch { return null; } })(),
      fetch(`${req.nextUrl.origin}/api/factory/disk-source`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ article }), signal: AbortSignal.timeout(12000) }).then((r) => r.json()).catch(() => null),
      resolveBrandKit(db, article, "").catch(() => null), // V24 · фикс-айдентика бренда (голос/персона/шрифт/цвет/CTA/бан/хэштеги)
    ]);
    const lowServices = (balances as Record<string, unknown>[]).filter((s) => s && s.low === true).map((s) => String(s.service));
    // наличие материала под товар: real = реальная съёмка (catalog/диск, не WB) → disk_real база; photo = только WB-фото → i2v-стартовый кадр
    const diskFound = !!(diskRes && diskRes.found);
    const diskKind = String(diskRes?.source?.disk || "");
    const hasRealFootage = diskFound && diskKind !== "wb" && (((diskRes.videos || []).length > 0) || ((diskRes.images || []).length > 0));
    const hasProductPhoto = diskFound && (diskRes.images || []).length > 0;
    const footage: "real" | "photo" | "none" = hasRealFootage ? "real" : hasProductPhoto ? "photo" : "none";

    // 2) доступные движки: оффлайн (available:false) исключаем + гард по балансам (AI-движок без денег → не предлагаем, есть бесплатный disk_real)
    const blockedByBudget: string[] = [];
    const available = allToolKeys().filter((t) => {
      if (TOOL_SCHEMAS[t]?.available === false) return false;
      const svc = TOOL_SERVICE[t];
      if (svc && lowServices.includes(svc)) { blockedByBudget.push(t); return false; }
      return true;
    });
    if (blockedByBudget.length) warnings.push(`низкий баланс (${lowServices.join("/")}) — исключены движки: ${blockedByBudget.join(", ")} → роутинг на бесплатные`);
    // shotstack нагружен (сборка+титры, без альтернативы) → не блокируем, но предупреждаем при низком балансе
    if (lowServices.includes("shotstack")) warnings.push("низкий баланс shotstack — пополни, иначе сборка/титры встанут (движок не исключён: замены нет)");
    // все движки выпали (баланс/оффлайн) — не шлём Claude пустой список (иначе галлюцинация инструмента), отдаём честно
    if (!available.length) return NextResponse.json({ ok: true, filled: 0, skipped: targets.length, byTool: {}, cost_estimate: "≈ $0.00", grounded: { footage, low_balance: lowServices, playbook: !!pbRow, learning: !!(lh && (lh as string).trim()) }, warnings: [...warnings, "нет доступных движков — все заблокированы балансом/отключены, пополни баланс"], nodes: [] });
    const digests = available.map(toolDigest).filter(Boolean).join("\n\n");
    const grounding = buildGrounding(niche, lh as string, pbRow as Record<string, unknown> | null, footage, lowServices);

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
- закадровая озвучка (node_type voiceover/narration) → elevenlabs (премиум RU-голос поверх реальной съёмки/b-roll).
  Это СИЛЬНЫЙ анти-слоп формат: живое видео + проф. русский голос, без AI-актёра в кадре.
- НЕ ставь creatify/seedance в каждую вторую ноду. Если кадр можно снять реально → disk_real.
- ВАЖНО: has_real_asset=false НЕ значит «съёмки нет» — оператор прицепит реальный клип позже. Для ролей
  problem|solution|proof держи disk_real ПО УМОЛЧАНИЮ; seedance — только для hook-ревила/динамики или
  когда кадр физически нельзя снять. Уважай tool_candidate ноды (его выбрал декомпозитор по доктрине) —
  меняй движок только при явной причине, не AI-фай весь граф.
${grounding}
ДОСТУПНЫЕ ДВИЖКИ И ИХ ПОЛЯ (заполняй params ТОЛЬКО валидными значениями из наборов/диапазонов; vertical 9:16):
${digests}

Бренд/товар: ${brandProfile(article, "")}${brandKitPromptBlock(kit)}
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
      // движок недоступен/неизвестен → откат ТОЛЬКО на доступный (кандидат → disk_real → первый доступный), не вслепую
      if (!available.includes(tool)) {
        const cand = String(node.tool || "");
        const fb = available.includes(cand) ? cand : (available.includes("disk_real") ? "disk_real" : available[0]);
        if (!fb) { warnings.push(`нода #${ord}: нет доступного движка — пропуск`); continue; }
        warnings.push(`нода #${ord}: движок «${tool || "—"}» недоступен → ${fb}`);
        tool = fb;
      }
      // мета-ключи ноды (role/onscreen_text/emotion/visual_desc) + params от Claude
      const meta = (node.params || {}) as Record<string, unknown>;
      let rawParams: Record<string, unknown> = { ...(a.params && typeof a.params === "object" ? a.params : {}) };
      for (const k of ["role", "onscreen_text", "emotion", "visual_desc"]) if (meta[k] !== undefined && rawParams[k] === undefined) rawParams[k] = meta[k];
      // V24 · накладываем фикс-айдентику бренда только на релевантные движку поля (creatify/shotstack)
      rawParams = applyKitToParams(tool, rawParams, kit);
      // нормализация с изоляцией краша на ОДНУ ноду (не валим весь батч → не теряем уже записанные)
      const norm0 = (t: string) => { try { return normalizeParams(t, rawParams); } catch (e) { warnings.push(`нода #${ord}: ошибка нормализации (${String((e as Error)?.message || e).slice(0, 40)})`); return null; } };
      let norm = norm0(tool); if (!norm) continue;
      // Ф2 · i2v без стартового кадра → даунгрейд на disk_real ВО ВСЕХ случаях (иначе нода сохранится как seedance
      // без image_url → submitNode вернёт ошибку «нужно image_url», нарушив критерий «валидное превью без 422»).
      if (norm.warnings.includes("needs_image") && !node.asset_url) {
        const dr = available.includes("disk_real") ? "disk_real" : tool;
        if (hasRealFootage) warnings.push(`нода #${ord}: ${tool} без кадра → disk_real (под товар есть реальная съёмка)`);
        else if (hasProductPhoto) warnings.push(`нода #${ord}: ${tool} без кадра → disk_real; фото товара есть на Я.Диске — можешь вернуть ${tool} и прицепить его`);
        else warnings.push(`нода #${ord}: ${tool} без кадра → disk_real (нет материала — прицепи ассет вручную)`);
        if (dr !== tool) { tool = dr; const dn = norm0(tool); if (!dn) continue; norm = dn; }
      }
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

    // Ф2 · смета: сумма по движкам + один прогон сборки (shotstack) если есть визуал
    const nodeCost = Object.entries(byTool).reduce((s, [t, n]) => s + (TOOL_COST[t] ?? 0.4) * n, 0);
    const assembly = written.length && !byTool.shotstack ? TOOL_COST.shotstack : 0; // сборка-рендер раз, если не считали как ноду
    const cost_estimate = `≈ $${(nodeCost + assembly).toFixed(2)}`;
    const grounded = { footage, low_balance: lowServices, playbook: !!pbRow, learning: !!(lh && (lh as string).trim()) };

    return NextResponse.json({ ok: true, filled: written.length, skipped, byTool, cost_estimate, grounded, warnings, nodes: written });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "autofill crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
