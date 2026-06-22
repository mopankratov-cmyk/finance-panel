import type { SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/internalFetch";
import { submitNode, pollNode, nodeHash, type EngineNode } from "./nodeEngine";
import { buildEdit, fixedBeatGrid, quantizeToBeats, shotstackSubmit, shotstackStatus, shotstackReady, type AssemblyClip } from "./shotstack";
import { remotionEngineSelected, remotionReady, remotionSubmit, remotionStatus } from "./remotionRender";
import { extractFrames } from "./serverMedia";
import { logGeneration } from "./genHistory";
import { tgReady, tgSendReview } from "./telegram";
import { classifyAssets, chooseBinding, type DiskAsset } from "./assetBind";
import { isPlaceholderSource } from "./toolSchemas";
import { isOurStorage } from "./rehostImage";
import { createHash } from "node:crypto";

// V3 исполнитель графа: рецепт (node_recipe_nodes) → генерация нод → Shotstack-сборка → ОТК → банк.
// Self-chaining машина по образцу jobs/tick: один тик = ОДИН шаг (<60с), состояние в node_recipes.run_plan.
// Платные шаги (fal/creatify/shotstack) защищены счётчиками; лиз бережёт от двойной обработки.

export type RunStep = "autofill" | "submit" | "gen-poll" | "assemble" | "render-submit" | "render-poll" | "otk" | "bank" | "done" | "failed";

export interface RunNode {
  ordinal: number; slot: string | null; node_type: string | null; tool: string | null;
  prompt: string; params: Record<string, unknown>; image_url: string | null; asset_url: string | null;
  duration_sec: number | null; onscreen_text: string | null;
  status: "pending" | "submitted" | "done" | "error" | "skip";
  token?: string; url?: string; error?: string; engine?: string;
}
export interface RunPlan {
  step: RunStep;
  nodes: RunNode[];
  render_id?: string | null;
  output_url?: string | null;
  pollCount?: number;
  renderCount?: number;
  otk?: { score: number | null; verdict?: string; axes?: unknown; issues?: string[] } | null;
  attempts?: number;
  lease_until?: string | null;
  error?: string | null;
  bestScore?: number | null;   // V3: лучший ОТК-балл за все попытки реген-петли
  bestUrl?: string | null;     // и сборка с этим баллом — банкуем ЕЁ
  notify?: boolean;            // V21/R5: батч-прогон → слать прошедшее ОТК в Telegram на ревью (студийные — нет, без спама)
  render_engine?: string | null;            // V23: "remotion" | "shotstack" — какой движок собирал (для poll/bank)
  reel_props?: Record<string, unknown> | null; // V23: пропсы ReelV5 для render-сервиса
  duration_frames?: number | null;          // V23: длительность ролика в кадрах (Remotion)
}

const LEASE_MS = 90_000;
const MAX_POLLS = 35;
const POLL_WAIT_MS = 12_000;
const MAX_RENDERS = 3;
export const MAX_STEP_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// «сборочные» инструменты не генерят отдельный клип — участвуют в монтаже/звуке
const ASSEMBLY_TOOLS = new Set(["shotstack", "sound", "music", "sharp"]);

function asNode(n: RunNode): EngineNode {
  return { tool: n.tool, node_type: n.node_type, prompt: n.prompt, params: n.params, image_url: n.image_url, asset_url: n.asset_url, duration_sec: n.duration_sec ?? undefined };
}

// нода РЕГЕНЕРИРУЕМА: сгенерирована движком (не реальный клип/сборка) — реген disk_real бессмыслен.
// elevenlabs (закадр) тоже НЕ реген: переозвучка под ОТК бессмысленна + реген должен трогать ВИЗУАЛ, не аудио.
function isRegenerable(n: RunNode): boolean {
  const t = String(n.tool || "").toLowerCase();
  return n.status === "done" && !!t && !ASSEMBLY_TOOLS.has(t) && t !== "captions" && t !== "disk" && t !== "disk_real" && t !== "elevenlabs";
}
const roleOf = (n: RunNode) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase();

// V23 · сборка пропсов ReelV5 (премиум-движок Remotion). ⚠️ v0 МЭППИНГ — груб, опт-ин (FACTORY_RENDER_ENGINE=remotion).
// Приоритет у явных пропсов (params.reel_props ноды) — их отдаёт бриф/автопилот, когда рецепт выверен.
// Иначе строим связную montage-раскладку: клипы → overlays по таймлайну, capt/hook → капшены, sound → музыка, hook/арт → CTA.
const REEL_FPS = 30;
const REEL_CTA_FRAMES = 55;
function chunkCaptions(text: string, article: string): { text: string; accent?: boolean }[] {
  const parts = String(text || "").split(/(?<=[.!?…])\s+|,\s+|\s—\s/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const art = String(article || "").toLowerCase();
  return parts.map((p) => ({ text: p, accent: /\d/.test(p) || (!!art && p.toLowerCase().includes(art)) || /wb|wildberries|купи|беги/i.test(p) }));
}
export function buildReelProps(plan: RunPlan, visualNodes: RunNode[], article: string): { inputProps: Record<string, unknown>; durationInFrames: number } {
  // явный override (точные пропсы из брифа) — высший приоритет (именно объект, не массив)
  const explicitNode = plan.nodes.find((n) => {
    const rp = n.params && (n.params as Record<string, unknown>)["reel_props"];
    return !!rp && typeof rp === "object" && !Array.isArray(rp);
  });
  const explicit = explicitNode ? ((explicitNode.params as Record<string, unknown>)["reel_props"] as Record<string, unknown>) : null;
  if (explicit) {
    const dur = Number(explicit["durationInFrames"]) || 614;
    return { inputProps: explicit, durationInFrames: dur };
  }
  // актёр-спайн: creatify/lipsync/actor; иначе первый клип как база
  const actorNode = plan.nodes.find((n) => n.status === "done" && n.url && (["creatify", "lipsync"].includes(String(n.tool).toLowerCase()) || roleOf(n) === "actor"));
  const overlayNodes = visualNodes.filter((n) => n !== actorNode);
  let t = 0;
  const overlays = overlayNodes.map((n) => {
    const dur = Math.round(Math.min(8, Math.max(2, Number(n.duration_sec) || 5)) * REEL_FPS);
    const o = { src: n.url!, from: t, duration: dur, startFrom: 0, flash: true };
    t += dur; return o;
  });
  // выбор спайна: реальная нода-актёр; иначе первый клип — и тогда исключаем его из врезок (иначе он рендерится дважды)
  let actorSrc: string | undefined;
  let renderOverlays = overlays;
  if (actorNode?.url) actorSrc = actorNode.url;
  else if (overlays.length) { actorSrc = overlays[0].src; renderOverlays = overlays.slice(1); }
  // длина актёра: собственная длительность ноды-актёра, иначе суммарная длина врезок, минимум 3с
  // (не схлопывается в 3с, когда актёр есть, но врезок нет)
  const actorFrames = actorNode ? Math.round((Number(actorNode.duration_sec) || 18) * REEL_FPS) : 0;
  const actorEnd = Math.max(t, actorFrames, REEL_FPS * 3);
  const durationInFrames = actorEnd + REEL_CTA_FRAMES;
  const hookNode = plan.nodes.find((n) => roleOf(n) === "hook") || plan.nodes[0];
  const captionNode = plan.nodes.find((n) => n.node_type === "captions");
  const capText = [hookNode?.onscreen_text, captionNode?.onscreen_text].filter(Boolean).join(". ");
  const captions = chunkCaptions(capText, article);
  const soundNode = plan.nodes.find((n) => ["sound", "music"].includes(String(n.tool).toLowerCase()));
  const audioSrc = soundNode?.asset_url || (soundNode?.params?.url as string) || undefined;
  const ctaTitle = (hookNode?.onscreen_text || article || "").toString().slice(0, 40) || undefined;
  const inputProps: Record<string, unknown> = {
    durationInFrames, actorEnd, overlays: renderOverlays,
    ...(actorSrc ? { actorSrc } : {}),
    ...(captions.length ? { captions } : { captions: [] }),
    ...(audioSrc ? { audioSrc } : {}),
    ...(ctaTitle ? { ctaTitle } : {}),
    ...(article ? { ctaButton: "ищи на WB" } : {}),
  };
  return { inputProps, durationInFrames };
}

// V3/V4: по слабейшей оси ОТК выбрать ноду-виновника для регена (только генеративную)
function pickCulprit(plan: RunPlan, axes: unknown): { node: RunNode; axis: string; val: number } | null {
  const a = (axes && typeof axes === "object") ? (axes as Record<string, unknown>) : {};
  let axis: string | null = null, val = 99;
  for (const k of ["hook", "retention", "native", "brand", "cta"]) {
    const v = Number(a[k]); if (!isNaN(v) && v < val) { val = v; axis = k; }
  }
  if (!axis) return null;
  let node: RunNode | undefined;
  if (axis === "hook") node = plan.nodes.find((n) => isRegenerable(n) && roleOf(n) === "hook");
  else if (axis === "cta") node = plan.nodes.find((n) => isRegenerable(n) && roleOf(n) === "cta");
  else if (axis === "brand") node = plan.nodes.find((n) => isRegenerable(n) && (roleOf(n) === "proof" || roleOf(n) === "solution"));
  // native/retention/фолбэк → первая генеративная нода (AI = источник слопа)
  if (!node) node = plan.nodes.find(isRegenerable);
  return node ? { node, axis, val } : null;
}

// V3/V4/R3: пере-генерить ноду-виновника — improve-prompt по дефектам → сброс ТОЛЬКО её → назад в submit.
// Бюджет (renderCount<MAX_RENDERS) проверяет ВЫЗЫВАЮЩИЙ. Общий путь для ОТК-фейла и артефакт-гейта.
async function regenCulprit(
  db: SupabaseClient, origin: string, id: number, plan: RunPlan, niche: string, article: string,
  node: RunNode, defects: string[], fixHint: string, reason: string, isArtifact = false,
): Promise<void> {
  try {
    const imp = await jpost(origin, "/api/factory/improve-prompt", {
      original: node.prompt || node.onscreen_text || "",
      defects: (defects || []).slice(0, 3),
      fixes: [fixHint],
      route: "node_graph", engine: node.engine || node.tool || "seedance",
      context: String(article || "").slice(0, 200),
    }, 55000);
    if (imp?.prompt) node.prompt = String(imp.prompt).slice(0, 2000);
  } catch { /* improve опционален — реген и без него */ }
  // при артефакт-регене plan.otk ещё/уже неактуален (рубрика не про этот брак) → не пишем стейл-балл, метим artifact_ok=false
  await logGeneration({ recipe_id: id, tool: node.tool, engine: node.engine, node_type: node.node_type, prompt: node.prompt, output_url: plan.output_url, otk_score: isArtifact ? null : (plan.otk?.score ?? null), otk_axes: isArtifact ? null : (plan.otk?.axes ?? null), artifact_ok: isArtifact ? false : null, status: "regen", attempt: (plan.renderCount || 0), reason, source: "graph_run", niche, article });
  node.status = "pending"; node.url = undefined; node.token = undefined;
  plan.render_id = null;
  plan.step = "submit"; // renderCount инкрементнётся в submit → жёстко ограничен MAX_RENDERS
  await savePlan(db, id, plan, { otk_verdict: plan.otk ?? null, otk_score: plan.otk?.score ?? null });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRunPlan(rows: any[]): RunPlan {
  const nodes: RunNode[] = (rows || []).map((r) => {
    const params = (r.params && typeof r.params === "object") ? r.params : {};
    const sug = (r.agent_suggestion && typeof r.agent_suggestion === "object") ? r.agent_suggestion : {};
    return {
      ordinal: typeof r.ordinal === "number" ? r.ordinal : 0,
      slot: r.slot ?? null, node_type: r.node_type ?? null, tool: r.tool ?? null,
      prompt: String(r.prompt || sug.voiceover || ""),
      params,
      image_url: r.asset_url || params.image_url || null,
      asset_url: r.asset_url || null,
      // колонка duration_sec ИЛИ инспекторский params.duration_sec (disk_real пишет только в params)
      duration_sec: typeof r.duration_sec === "number" ? r.duration_sec
        : (params.duration_sec != null && !isNaN(Number(params.duration_sec)) ? Number(params.duration_sec) : null),
      onscreen_text: params.onscreen_text || sug.onscreen_text || null,
      status: "pending" as const,
    };
  }).sort((a, b) => a.ordinal - b.ordinal);
  return { step: "submit", nodes, attempts: 0, pollCount: 0, renderCount: 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logSignal(db: SupabaseClient, ev: string, extra: Record<string, any>) {
  try { await db.from("cf_signals").insert({ event: ev, ...extra }); } catch { /* журнал best-effort */ }
}

async function savePlan(db: SupabaseClient, recipeId: number, plan: RunPlan, extra: Record<string, unknown> = {}) {
  await db.from("node_recipes").update({ run_plan: plan, updated_at: new Date().toISOString(), ...extra }).eq("id", recipeId);
}

// Авто-привязка ассетов товара к визуальным нодам БЕЗ источника (фикс пустого автопилота: autofill выбирает
// инструмент, но клип/фото привязывал только оператор в кокпите → в батче ноды падали «нет url/image_url»).
// Тянем content_assets по артикулу ОДИН раз и только если есть незаполненные ноды. Срабатывает лишь на нодах,
// которые и так упали бы → рабочие не трогает. disk_real без видео → перевод на seedance i2v из фото (нет съёмки → AI).
// ⚠️ ДЕНЬГИ: перевод disk_real($0)→seedance($0.42) рантайм-эскалирует стоимость, которую смета batch/route.ts
// (estimateRecipe, disk_real не в TOOL_COST) НЕ видит. В обычном случае запас REGEN_FACTOR=3 это поглощает
// (факт ≤ est×1.9 < est×3). Для UNATTENDED-масштаба правильный фикс — пост-autofill $-чек против бюджета батча
// (плюмбинг budget_usd в graphRun) — это долг (см. self-review B1), а не правка money-guard вслепую.
async function autoBindAssets(db: SupabaseClient, plan: RunPlan, article: string): Promise<void> {
  if (!article) return;
  const hasSrc = (n: RunNode) => {
    const p = (n.params || {}) as Record<string, unknown>;
    // preview_url ВКЛЮЧЁН: нода с одобренным оператором превью (V10-кэш по nodeHash) уже имеет источник —
    // если её тронуть (дописать image_url), hash сменится → кэш-чек упадёт → лишний оплаченный ререндер.
    // isPlaceholderSource: «picker»/пустое НЕ источник → нода с url="picker" попадёт в авто-байнд и получит
    // реальный ассет (иначе заглушка ехала в Remotion → 404). Источник есть, если ХОТЯ БЫ одно поле реальное.
    return [n.image_url, n.asset_url, p["url"], p["image_url"], p["preview_url"]].some((v) => !isPlaceholderSource(v));
  };
  const needs = plan.nodes.filter((n) => {
    const t = String(n.tool || "").toLowerCase();
    if (!t || ASSEMBLY_TOOLS.has(t) || t === "captions" || t === "elevenlabs" || t === "creatify") return false;
    if (n.status === "done" || n.status === "submitted") return false;
    return !hasSrc(n);
  });
  if (!needs.length) return;
  let assets: DiskAsset[] = [];
  try {
    const { data } = await db.from("content_assets").select("disk,kind,url").eq("article", article).not("url", "is", null).limit(60);
    assets = (data as DiskAsset[] | null) || [];
  } catch { return; } // каталог недоступен — ноды упадут штатно, как раньше
  const pool = classifyAssets(assets);
  let imgIdx = 0; // разные стартовые фото на разные i2v-ноды (анти-сэйминес: не 5 клипов с одного кадра)
  for (const n of needs) {
    const b = chooseBinding(String(n.tool || ""), false, pool, imgIdx);
    if (!b) continue;
    if (b.tool) n.tool = b.tool;
    if (b.asset_url) n.asset_url = b.asset_url;
    if (b.image_url) { n.image_url = b.image_url; (n.params as Record<string, unknown>)["image_url"] = b.image_url; imgIdx++; }
  }
}

// Durable-персист сгенерённых клипов в наш бакет + каталог (content_assets). КОРЕНЬ: i2v-клипы (seedance/kling/
// pika) живут на fal.media — эфемерное CDN fal → reel-recompose/ре-кат «потом» не из чего делать, когда URL
// протухнет. Здесь скачиваем каждый внешний клип в factory-media/clips/<sha1>.mp4, ПОДМЕНЯЕМ node.url на наш
// (бонус: VM рендерит из нашего бакета, не с fal → надёжнее, как rehost фото) и заводим строку content_assets
// (disk=gen, kind=clip — библиотека по артикулу/нише). Best-effort+идемпотентно (дедуп по source_url): любой
// сбой → клип остаётся на fal (пайплайн не падает). disk_real/уже-наши URL пропускаем.
const CLIP_BUCKET = "factory-media";
export async function persistClips(db: SupabaseClient, nodes: RunNode[], article: string, niche: string): Promise<void> {
  await Promise.all(nodes.map(async (n) => {
    const src = n.url;
    if (!src || !/^https?:\/\//i.test(src) || isOurStorage(src)) return; // пусто/не-http/уже у нас
    try {
      const { data: dup } = await db.from("content_assets").select("url").eq("disk", "gen").contains("analysis", { source_url: src }).maybeSingle();
      if (dup && (dup as { url?: string }).url) { n.url = (dup as { url: string }).url; return; } // уже сохранён — переиспользуем durable
      const r = await fetch(src, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!r.ok) return;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return;
      const path = `clips/${createHash("sha1").update(src).digest("hex")}.mp4`;
      const { error } = await db.storage.from(CLIP_BUCKET).upload(path, buf, { contentType: "video/mp4", upsert: true });
      if (error) return;
      const pub = db.storage.from(CLIP_BUCKET).getPublicUrl(path).data?.publicUrl;
      if (!pub) return;
      await db.from("content_assets").insert({ disk: "gen", kind: "clip", niche: niche || null, article: article || null, url: pub, analyzed: true, analysis: { source_url: src, role: roleOf(n), tool: n.tool || null, source: "clip_library" } });
      n.url = pub; // рендерим из durable-URL
    } catch { /* best-effort — теряем клип на fal, но пайплайн жив */ }
  }));
}

// Захват рецепта на исполнение: status=running, активный шаг, свободный лиз.
export async function claimNextRecipe(db: SupabaseClient, recipeId?: number): Promise<{ id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string } | null> {
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + LEASE_MS).toISOString();
  let q = db.from("node_recipes").select("id,article,niche,mode,run_plan,status").eq("status", "running").limit(5);
  if (recipeId) q = db.from("node_recipes").select("id,article,niche,mode,run_plan,status").eq("id", recipeId).limit(1);
  const { data } = await q;
  const rows = (data as Record<string, unknown>[] | null) || [];
  for (const row of rows) {
    const plan = (row.run_plan as RunPlan) || null;
    if (!plan || plan.step === "done" || plan.step === "failed") continue;
    if (plan.lease_until && new Date(plan.lease_until as string).getTime() > Date.now()) continue; // занят
    // АТОМАРНЫЙ захват (compare-and-swap): ставим лиз ТОЛЬКО если в БД он всё ещё свободен.
    // Иначе два параллельных тика (resurrection GET каждые 4с + self-chain) дважды оплатят fal/creatify.
    plan.lease_until = leaseIso;
    const { data: won, error: wErr } = await db.from("node_recipes")
      .update({ run_plan: plan, updated_at: nowIso }).eq("id", row.id)
      .or(`run_plan->>lease_until.is.null,run_plan->>lease_until.lt.${nowIso}`)
      .select("id").maybeSingle();
    // CAS-предикат не сработал (wErr) → НЕ клеймим вслепую: безусловный апдейт убил бы атомарность, два тика
    // захватили бы ОДИН рецепт = двойная оплата fal/creatify. Пропускаем — воскресит следующий тик/опрос (как в jobs.ts).
    if (wErr) continue;
    if (!won) continue; // гонку проиграли — рецепт уже захватил другой тик
    return { id: row.id as number, plan, article: String(row.article || ""), niche: String(row.niche || ""), mode: String(row.mode || "audience") };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jpost(origin: string, path: string, body: unknown, ms = 90000): Promise<any> {
  const r = await internalFetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return r.json().catch(() => ({}));
}

// ОДИН шаг исполнения графа.
export async function runRecipeStep(
  db: SupabaseClient, origin: string,
  ctx: { id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string },
): Promise<void> {
  const { id, plan, article, niche, mode } = ctx;
  plan.lease_until = null; // снимаем лиз в начале — повторный заход разрешён после сохранения

  // ── autofill (V21): черновик-рецепт из батча сам конфигурируется (§17 ИИ-режиссёр) ПЕРЕД генерацией ──
  // Один тик = autofill (~45с Claude, влезает в 60с), затем перечитываем заполненные ноды и идём в submit.
  // human_edited-ноды autofill не трогает (force=false) → ручная настройка сохраняется. Best-effort: фейл → submit как есть.
  if (plan.step === "autofill") {
    // ИДЕМПОТЕНТНОСТЬ (DB-state, переживает ретраи шага): зовём Claude ТОЛЬКО если рецепт ещё не сконфигурён.
    // Уже настроенный (ai_autofilled/human_chosen + tool) → пропускаем платный вызов, сразу в submit.
    const { data: cur } = await db.from("node_recipe_nodes").select("tool,source").eq("recipe_id", id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const needsFill = ((cur as any[]) || []).some((n) => !n.tool || (n.source !== "ai_autofilled" && n.source !== "human_chosen"));
    if (needsFill) {
      try {
        const r = await jpost(origin, "/api/factory/autofill", { recipe_id: id }, 90000);
        await logSignal(db, "batch_autofill", { recipe_id: id, niche, article: article || null, params: { filled: r?.filled ?? null, byTool: r?.byTool ?? null } });
      } catch { /* автозаполнение best-effort — пойдём с тем, что есть */ }
    }
    // перечитываем ноды с заполненными tool/params/prompt и пересобираем СПИСОК нод (счётчики прогона не трогаем)
    const { data } = await db.from("node_recipe_nodes").select("ordinal,slot,node_type,tool,prompt,params,asset_url,duration_sec,agent_suggestion").eq("recipe_id", id).order("ordinal");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan.nodes = buildRunPlan((data as any[]) || []).nodes;
    plan.step = "submit";
    await savePlan(db, id, plan, { status: "running" });
    return;
  }

  // ── submit: разослать генеративные ноды на их движки ──
  if (plan.step === "submit") {
    const renderCount = (plan.renderCount || 0) + 1;
    if (renderCount > MAX_RENDERS) throw new Error("превышен лимит запусков генерации графа — стоп для бюджета");
    // авто-привязка ассетов товара к нодам без источника (фикс пустого автопилота, см. assetBind.ts)
    await autoBindAssets(db, plan, article);
    for (const n of plan.nodes) {
      const tool = String(n.tool || "").toLowerCase();
      if (!tool || ASSEMBLY_TOOLS.has(tool) || tool === "captions") { n.status = "skip"; continue; }
      if (n.status === "done" || n.status === "submitted") continue;
      // V10: владелец принял превью этой ноды (hash совпадает с текущими prompt/params/вход) → берём готовый
      // клип, НЕ платим fal повторно. Привязка к nodeHash инвалидирует при любой правке ноды.
      const pv = (n.params || {})["preview_url"]; const ph = (n.params || {})["preview_hash"];
      if (pv && ph && nodeHash(asNode(n)) === ph) { n.status = "done"; n.url = String(pv); n.engine = "preview"; continue; }
      const r = await submitNode(asNode(n));
      n.engine = r.engine;
      if (r.error) { n.status = "error"; n.error = r.error; }
      else if (r.done && r.url) { n.status = "done"; n.url = r.url; }
      else if (r.token) { n.status = "submitted"; n.token = r.token; }
      else { n.status = "error"; n.error = "движок без токена"; }
    }
    plan.renderCount = renderCount;
    plan.step = "gen-poll"; plan.pollCount = 0;
    await savePlan(db, id, plan);
    return;
  }

  // ── gen-poll: ждать готовности всех submitted-нод ──
  if (plan.step === "gen-poll") {
    const pending = plan.nodes.filter((n) => n.status === "submitted");
    if (pending.length) {
      await sleep(POLL_WAIT_MS);
      for (const n of pending) {
        if (!n.token) { n.status = "error"; n.error = "нет токена"; continue; }
        const s = await pollNode(n.token);
        if (s.status === "done" && s.url) { n.status = "done"; n.url = s.url; }
        else if (s.status === "error") { n.status = "error"; n.error = s.error; }
      }
    }
    const stillPending = plan.nodes.filter((n) => n.status === "submitted");
    const pollCount = (plan.pollCount || 0) + 1;
    if (stillPending.length && pollCount < MAX_POLLS) {
      plan.pollCount = pollCount;
      await savePlan(db, id, plan, { status: "running" });
      return;
    }
    // таймаут оставшихся → помечаем error, идём дальше с тем, что готово
    for (const n of stillPending) { n.status = "error"; n.error = "render timeout"; }
    plan.step = "assemble";
    await savePlan(db, id, plan);
    return;
  }

  // ── assemble: смонтировать готовые клипы через Shotstack ──
  if (plan.step === "assemble") {
    // role="skip" (инспектор disk_real) → выкинуть клип из сборки; elevenlabs — это АУДИО (закадр), не визуал
    const visualNodes = plan.nodes.filter((n) => n.status === "done" && n.url && n.node_type !== "captions" && String(n.tool).toLowerCase() !== "elevenlabs" && String(((n.params || {}) as Record<string, unknown>)["role"] || "").toLowerCase() !== "skip");
    if (!visualNodes.length) throw new Error("нет готовых клипов для сборки (все ноды упали — проверь image_url/ключи)");

    // durable-персист клипов в наш бакет (fal.media эфемерно) → библиотека для ре-ката + надёжный рендер.
    // ДО сборки пропсов: подменит node.url на наш, и render/shotstack пойдут уже с durable-URL. Best-effort.
    await persistClips(db, visualNodes, article, niche);

    // ── V23 · движок REMOTION (премиум ReelV5) — опт-ин FACTORY_RENDER_ENGINE=remotion, минует Shotstack-схему ──
    if (remotionEngineSelected()) {
      if (!remotionReady()) throw new Error("FACTORY_RENDER_ENGINE=remotion, но REMOTION_RENDER_URL не задан (render-сервис на VM)");
      const { inputProps, durationInFrames } = buildReelProps(plan, visualNodes, article);
      plan.reel_props = inputProps;
      plan.duration_frames = durationInFrames;
      plan.render_engine = "remotion";
      plan.step = "render-submit";
      await savePlan(db, id, plan);
      return;
    }

    // одиночный клип без Shotstack → используем как есть (минуем рендер)
    if (visualNodes.length === 1 && !shotstackReady()) {
      plan.output_url = visualNodes[0].url!;
      plan.step = "otk";
      await savePlan(db, id, plan, { output_url: plan.output_url });
      return;
    }
    if (!shotstackReady()) {
      // нет монтажника и клипов несколько — берём первый (деградация), отметим
      plan.output_url = visualNodes[0].url!;
      plan.error = "SHOTSTACK_API_KEY не задан — взят первый клип без монтажа";
      plan.step = "otk";
      await savePlan(db, id, plan, { output_url: plan.output_url });
      return;
    }

    // нода shotstack несёт настройки монтажа (плоские точечные ключи из инспектора) — раньше игнорились
    const ssNode = plan.nodes.find((n) => String(n.tool).toLowerCase() === "shotstack");
    const ssp = (ssNode?.params || {}) as Record<string, unknown>;
    const transIn = (ssp["transition.in"] as string) || "none";   // совпадает с дефолтом инспектора (WYSIWYG)
    const ssEffect = ssp["effect"] as string | undefined;
    const ssFilter = ssp["filter"] as string | undefined;
    const ssFontSize = Number(ssp["font.size"]);
    const ssFontColor = ssp["font.color"] as string | undefined;
    // вывод/композиция ноды shotstack (аспект сейчас зашит 9:16 → теперь из ноды)
    const ssAspect = ((ssp["output.aspectRatio"] as string) || (ssp["aspect_ratio"] as string) || "9:16") as "9:16" | "1:1" | "16:9";
    const ssOutFormat = ssp["output.format"] as string | undefined;
    const ssFps = Number(ssp["output.fps"]);
    const ssQuality = ssp["output.quality"] as string | undefined;
    const ssFit = ssp["fit"] as string | undefined;
    const ssBg = (ssp["timeline.background"] as string) || (ssp["background"] as string) || undefined;

    // раскладка по таймлайну: видео-ноды последовательно, длительность из ноды.
    // disk_real несёт trim_start/trim_end (обрезка исходника) + asset.volume.
    let t = 0;
    const raw: AssemblyClip[] = visualNodes.map((n, i) => {
      const p = (n.params || {}) as Record<string, unknown>;
      const trimStart = Number(p["trim_start"]);
      const trimEnd = Number(p["trim_end"]);
      const baseLen = !isNaN(trimEnd) && trimEnd > 0 && !isNaN(trimStart) ? Math.max(1, trimEnd - trimStart)
        : (!isNaN(trimEnd) && trimEnd > 0 ? trimEnd : (Number(n.duration_sec) || 5));
      const len = Math.min(8, Math.max(2, baseLen));
      const clip: AssemblyClip = { url: n.url!, type: "video", start: t, length: len };
      if (!isNaN(trimStart) && trimStart > 0) clip.trim = trimStart;
      const cv = Number(p["asset.volume"]); if (!isNaN(cv)) clip.volume = cv;
      if (typeof p["asset.fit"] === "string") clip.fit = p["asset.fit"] as string;
      if (i > 0 && transIn !== "none") clip.transition = transIn;
      t += len;
      return clip;
    });
    const total = Math.max(5, t);
    const clips = quantizeToBeats(raw, fixedBeatGrid(120, total));

    const hookNode = plan.nodes.find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || plan.nodes[0];
    const hookText = (hookNode?.onscreen_text || "").toString().slice(0, 120) || undefined;
    const captionNode = plan.nodes.find((n) => n.node_type === "captions");
    const caption = (captionNode?.onscreen_text || (article ? "Ищи на WB: " + article : "")).toString().slice(0, 120) || undefined;
    const soundNode = plan.nodes.find((n) => String(n.tool).toLowerCase() === "sound" || String(n.tool).toLowerCase() === "music");
    const audioUrl = (soundNode?.asset_url || (soundNode?.params?.url as string) || "") || undefined;
    const audioVolume = typeof soundNode?.params?.volume === "number" ? (soundNode.params.volume as number) : 0.3;
    // V22 · закадр ElevenLabs (отдельная дорожка, поверх музыки; музыка дакается дефолтом 0.3)
    const voiceNode = plan.nodes.find((n) => String(n.tool).toLowerCase() === "elevenlabs" && n.status === "done" && n.url);
    const voiceoverUrl = voiceNode?.url || undefined;
    const voiceoverVolume = typeof voiceNode?.params?.volume === "number" ? (voiceNode.params.volume as number) : 1;
    const fontUrl = (process.env.SHOTSTACK_FONT_URL || "").trim() || undefined;
    const fontFamily = (process.env.SHOTSTACK_FONT_FAMILY || "").trim() || undefined;

    const edit = buildEdit({ clips, hookText, caption, audioUrl, audioVolume, voiceoverUrl, voiceoverVolume, fontUrl, fontFamily, aspect: ssAspect,
      fontSize: isNaN(ssFontSize) ? undefined : ssFontSize, fontColor: ssFontColor, effect: ssEffect, filter: ssFilter,
      outputFormat: ssOutFormat, fps: isNaN(ssFps) ? undefined : ssFps, quality: ssQuality, fit: ssFit, background: ssBg });
    // сохраним edit в run_plan для воспроизводимости
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plan as any).edit_json = edit;
    plan.step = "render-submit";
    await savePlan(db, id, plan);
    return;
  }

  // ── render-submit: запустить рендер (Remotion VM или Shotstack) ──
  if (plan.step === "render-submit") {
    if (plan.render_id) { plan.step = "render-poll"; plan.pollCount = 0; await savePlan(db, id, plan, { status: "running" }); return; }
    if (plan.render_engine === "remotion") {
      const renderId = await remotionSubmit("ReelV5", plan.reel_props || {}, plan.duration_frames || undefined);
      if (!renderId) throw new Error("remotionSubmit вернул null — проверь REMOTION_RENDER_URL/REMOTION_RENDER_TOKEN/живость VM");
      plan.render_id = renderId; plan.step = "render-poll"; plan.pollCount = 0;
      await savePlan(db, id, plan, { render_id: renderId, status: "running" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edit = (plan as any).edit_json as Record<string, unknown>;
    if (!edit) throw new Error("нет edit_json для рендера");
    const renderId = await shotstackSubmit(edit);
    if (!renderId) throw new Error("shotstackSubmit вернул null — проверь SHOTSTACK_API_KEY/схему");
    plan.render_id = renderId; plan.step = "render-poll"; plan.pollCount = 0;
    await savePlan(db, id, plan, { render_id: renderId, status: "running" });
    return;
  }

  // ── render-poll: ждать рендер (Remotion VM или Shotstack) ──
  if (plan.step === "render-poll") {
    await sleep(POLL_WAIT_MS);
    const pollCount = (plan.pollCount || 0) + 1;
    const engineName = plan.render_engine === "remotion" ? "Remotion" : "Shotstack";
    const s = plan.render_engine === "remotion" ? await remotionStatus(String(plan.render_id)) : await shotstackStatus(String(plan.render_id));
    if (s.status === "done" && s.videoUrl) {
      plan.output_url = s.videoUrl; plan.step = "otk";
      await savePlan(db, id, plan, { output_url: s.videoUrl });
    } else if (s.status === "error" && s.retryable !== true) {
      // настоящий отказ рендера — фейлим. Транзиент/404 (retryable) НЕ роняет уже оплаченный рендер — продолжаем опрос до таймаута.
      throw new Error(`${engineName} error: ` + (s.error || "unknown"));
    } else if (pollCount >= MAX_POLLS) {
      throw new Error(`${engineName} render timeout` + (s.status === "error" ? ` (последний опрос: ${s.error})` : ""));
    } else {
      plan.pollCount = pollCount;
      await savePlan(db, id, plan, { status: "running" });
    }
    return;
  }

  // ── otk: кадры → видео-критик → вердикт ──
  if (plan.step === "otk") {
    const url = plan.output_url;
    if (!url) throw new Error("нет output_url для ОТК");
    const frames = await extractFrames(url);
    if (!frames.length) { // кадры не извлеклись → банк без ОТК (не блокируем)
      plan.otk = null; plan.step = "bank";
      await savePlan(db, id, plan);
      return;
    }
    // R3 · АРТЕФАКТ-ГЕЙТ до рубрики: сломанный AI-брак (уанкэни/текст-блид/руки/морфинг) → реген, к рубрике/человеку не доходит
    if ((plan.renderCount || 0) < MAX_RENDERS) {
      const art = await jpost(origin, "/api/factory/artifact-check", { frames }, 45000);
      if (art && art.ok === false) {
        const culprit = pickCulprit(plan, { native: 1 }); // артефакты → генеративная нода (фолбэк-выбор)
        if (culprit) {
          const defs = Array.isArray(art.defects) ? art.defects : [];
          await regenCulprit(db, origin, id, plan, niche, article, culprit.node, defs, "убрать сломанные AI-артефакты: " + (defs.join("; ") || "уанкэни/морфинг/кривые руки"), "артефакты: " + (defs.join(", ") || "broken"), true);
          return;
        }
      }
    }
    const hookNode = plan.nodes.find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || plan.nodes[0];
    const v = await jpost(origin, "/api/factory/video-critic", { frames, hook: hookNode?.onscreen_text || hookNode?.prompt || "", mode, article, niche }, 55000);
    const score = typeof v?.score === "number" ? v.score : null;
    plan.otk = { score, verdict: v?.verdict, axes: v?.axes || null, issues: Array.isArray(v?.issues) ? v.issues : [] };
    // V3: запоминаем ЛУЧШУЮ сборку за все попытки реген-петли (банкуем её, не последнюю)
    if (score != null && score > (plan.bestScore ?? -1)) { plan.bestScore = score; plan.bestUrl = url; }

    // V3+V4: regen-on-fail — score<7 и есть бюджет рендеров → чиним ноду-виновника и пере-генерим ТОЛЬКО её
    const canRegen = score != null && score < 7 && (plan.renderCount || 0) < MAX_RENDERS;
    const culprit = canRegen ? pickCulprit(plan, plan.otk.axes) : null;
    if (canRegen && culprit) {
      await regenCulprit(db, origin, id, plan, niche, article, culprit.node, plan.otk.issues || [], `усилить ось «${culprit.axis}» (сейчас ${culprit.val}/5)`, `ось ${culprit.axis} ${culprit.val}/5`);
      return;
    }
    plan.step = "bank";
    await savePlan(db, id, plan, { otk_verdict: plan.otk, otk_score: score });
    return;
  }

  // ── bank: сохранить в библиотеку + финализировать рецепт + сигнал ──
  if (plan.step === "bank") {
    // V3: банкуем ЛУЧШУЮ сборку за все попытки реген-петли (а не последнюю, которая могла просесть)
    const url = plan.bestUrl || plan.output_url;
    const score = plan.bestScore != null ? plan.bestScore : (plan.otk?.score ?? null);
    const hookNode = plan.nodes.find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || plan.nodes[0];
    const hook = (hookNode?.onscreen_text || hookNode?.prompt || "").toString().slice(0, 200);
    // в библиотеку контента (каталог кокпита)
    let catalogUrl: string | null = null;
    if (url) {
      try {
        const g = await jpost(origin, "/api/factory/gen-save", { video_url: url, article, niche, hook, route: "node_graph", engine: plan.render_engine || "shotstack", otk: score }, 40000); // ≤40с: влезть в maxDuration 60 тика (был 120с → Vercel убивал handler, catalogUrl терялся)
        catalogUrl = g?.url || null;
      } catch { /* банк библиотеки опционален */ }
    }
    const status = score == null ? "otk_pass" : score >= 7 ? "otk_pass" : "otk_fail";
    plan.step = "done";
    await savePlan(db, id, plan, { status, output_url: catalogUrl || url || null });
    await logSignal(db, status === "otk_pass" ? "approved" : "rejected", {
      recipe_id: id, niche, article, mode, format: null, engine: plan.render_engine || "shotstack",
      axes: plan.otk?.axes ?? null, reason_chip: status === "otk_fail" ? (plan.otk?.issues?.[0] || "ОТК<7") : null,
    });
    // V21/R5: батч-прогон прошёл ОТК → шлём оператору в Telegram на ревью (студийные прогоны — нет, без спама)
    if (plan.notify && status === "otk_pass" && (catalogUrl || url) && tgReady()) {
      try { await tgSendReview((catalogUrl || url)!, `${hook || article || "генерация"}\nОТК ${score != null ? Math.round(score * 10) : "—"}/100 · ниша ${niche}`, id); } catch { /* telegram опционален */ }
    }
    return;
  }
}
