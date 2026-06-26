import type { SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/internalFetch";
import { submitNode, pollNode, nodeHash, type EngineNode } from "./nodeEngine";
import { buildEdit, fixedBeatGrid, quantizeToBeats, shotstackSubmit, shotstackStatus, shotstackReady, type AssemblyClip } from "./shotstack";
import { remotionEngineSelected, remotionReady, remotionSubmit, remotionStatus } from "./remotionRender";
import { extractFrames } from "./serverMedia";
import { logGeneration } from "./genHistory";
import { tgReady, tgSendReview } from "./telegram";
import { speechReady } from "./elevenlabs";
import { classifyAssets, chooseBinding, assetMatchesArticle, type DiskAsset } from "./assetBind";
import { isPlaceholderSource } from "./toolSchemas";
import { isOurStorage } from "./rehostImage";
import { createHash, randomUUID } from "node:crypto";
import type { ExecutionLogEntry, RunNode, RunPlan, RunStep } from "./graphTypes";
import { estimateRunCost } from "./costEstimate";
import { nicheFromArticle, scoreRubric, type AxisScores, type ContentMode, type RubricNiche } from "./rubric";

export type { ExecutionLogEntry, RunNode, RunPlan, RunStep } from "./graphTypes";

// V3 исполнитель графа: рецепт (node_recipe_nodes) → генерация нод → Shotstack-сборка → ОТК → банк.
// Self-chaining graph-run runner: один тик = ОДИН шаг (<60с), состояние в node_recipes.run_plan.
// Платные шаги (fal/creatify/shotstack) защищены счётчиками; лиз бережёт от двойной обработки.

const LEASE_MS = 90_000;
const MAX_POLLS = 35;
const POLL_WAIT_MS = 12_000;
const MAX_RENDERS = 3;
export const MAX_STEP_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function otkRegenEnabled(): boolean {
  return process.env.FACTORY_OTK_REGEN === "1";
}

export function makeRunId(recipeId: number): string {
  return `run_${recipeId}_${randomUUID().slice(0, 8)}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function keepTail<T>(items: T[] | null | undefined, max = 120): T[] {
  return (items || []).slice(-max);
}

function appendExecutionLog(plan: RunPlan, entry: ExecutionLogEntry): void {
  plan.execution_log = keepTail([...(plan.execution_log || []), entry]);
}

function startExecutionLog(plan: RunPlan, step: string, input_artifact: string | null, note?: string | null): ExecutionLogEntry {
  const runId = plan.run_id || "run_unknown";
  return {
    run_id: runId,
    step,
    started_at: new Date().toISOString(),
    finished_at: null,
    status: "running",
    input_artifact,
    output_artifact: null,
    error: null,
    note: note || null,
  };
}

function finishExecutionLog(plan: RunPlan, entry: ExecutionLogEntry, status: ExecutionLogEntry["status"], output_artifact: string | null, error?: string | null, note?: string | null): void {
  entry.finished_at = new Date().toISOString();
  entry.status = status;
  entry.output_artifact = output_artifact;
  entry.error = error || null;
  if (note !== undefined) entry.note = note;
  appendExecutionLog(plan, entry);
}

function summarizeWarnings(plan: RunPlan): string | null {
  const warnings = Array.from(new Set((plan.warnings || []).map((s) => String(s).trim()).filter(Boolean)));
  plan.warnings = warnings.length ? warnings : null;
  return warnings.length ? warnings.join(" | ") : null;
}

// «сборочные» инструменты не генерят отдельный клип — участвуют в монтаже/звуке
const ASSEMBLY_TOOLS = new Set(["shotstack", "sound", "music", "sharp"]);

function asNode(n: RunNode): EngineNode {
  return { tool: n.tool, node_type: n.node_type, prompt: n.prompt, params: n.params, image_url: n.image_url, asset_url: n.asset_url, duration_sec: n.duration_sec ?? undefined };
}

function textOfNode(n: RunNode | undefined | null): string {
  if (!n) return "";
  const p = (n.params || {}) as Record<string, unknown>;
  return String(n.onscreen_text || p["onscreen_text"] || p["script"] || p["override_script"] || n.prompt || "").trim();
}

function graphRunOtkFallback(input: { mode: string; niche: string; article: string; productName?: string; reason: string; framesCount: number }) {
  const mode: ContentMode = input.mode === "sell" ? "sell" : "audience";
  const allowedNiches = new Set<RubricNiche>(["clothing", "toys", "cosmetics", "default"]);
  const niche = allowedNiches.has(input.niche as RubricNiche) ? input.niche as RubricNiche : nicheFromArticle(input.article, input.productName || "");
  const axes: AxisScores = mode === "sell"
    ? { hook: 3, retention: 3, native: input.framesCount ? 3 : 2, brand: 4, cta: 4 }
    : { hook: 3, retention: 4, native: input.framesCount ? 3 : 2, brand: 3, cta: 4 };
  const { weighted, score, verdict, floorFail } = scoreRubric(axes, mode, niche);
  return {
    score,
    verdict,
    axes,
    issues: [
      `graph-run OTK fallback: ${input.reason}`,
      input.framesCount ? "критик не дал числовую оценку; использована детерминированная fail-open рубрика" : "кадры не извлечены; использована fail-open оценка без визуального ОТК",
    ],
    basis: "graph_fallback",
    basisReason: input.framesCount ? "critic_missing_score" : "frames_missing",
    weighted,
    floorFail,
  };
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
  const capText = [textOfNode(hookNode), textOfNode(captionNode)].filter(Boolean).join(". ");
  const captions = chunkCaptions(capText, article);
  const soundNode = plan.nodes.find((n) => ["sound", "music"].includes(String(n.tool).toLowerCase()));
  const audioSrc = soundNode?.asset_url || (soundNode?.params?.url as string) || undefined;
  const ctaTitle = (textOfNode(hookNode) || article || "").toString().slice(0, 40) || undefined;
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
  return { step: "submit", nodes, attempts: 0, pollCount: 0, renderCount: 0, cost_hint: estimateRunCost(nodes as unknown as Record<string, unknown>[]) };
}

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
async function autoBindAssets(db: SupabaseClient, plan: RunPlan, article: string, niche: string): Promise<void> {
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
    const { data } = await db.from("content_assets").select("disk,kind,url,duration_sec").eq("article", article).not("url", "is", null).limit(60);
    const raw = (data as DiskAsset[] | null) || [];
    // ГАРД от кросс-контаминации («пистолет в сумке»): даже если строка каталога мислейбл (article=CLR…, а путь
    // prepared/TT…), НЕ привязываем чужой кадр к рецепту. Источник распознаём по артикулу в пути prepared/i2v-src.
    assets = raw.filter((a) => assetMatchesArticle(a.url, article));
    const dropped = raw.length - assets.length;
    if (dropped) { try { await logSignal(db, "asset_article_mismatch", { niche, article, params: { dropped, kept: assets.length } }); } catch { /* сигнал best-effort */ } }
  } catch { return; } // каталог недоступен — ноды упадут штатно, как раньше
  const pool = classifyAssets(assets);
  let imgIdx = 0; // разные стартовые фото на разные i2v-ноды (анти-сэйминес: не 5 клипов с одного кадра)
  let unbound = 0;
  for (const n of needs) {
    const b = chooseBinding(String(n.tool || ""), false, pool, imgIdx);
    if (!b) { unbound++; continue; }
    if (b.tool) n.tool = b.tool;
    if (b.asset_url) n.asset_url = b.asset_url;
    if (b.duration_sec && !n.duration_sec) n.duration_sec = b.duration_sec;
    if (b.image_url) { n.image_url = b.image_url; (n.params as Record<string, unknown>)["image_url"] = b.image_url; imgIdx++; }
  }
  // часть нод осталась без источника (нет реальной съёмки/WB-фото под товар) → они упадут в submit.
  // Раньше тихо → автопилот «пустой» без причины; теперь сигнал, чтобы оператор видел почему.
  if (unbound) { try { await logSignal(db, "asset_bind_empty", { niche, article, params: { unbound, needs: needs.length, assets: assets.length } }); } catch { /* сигнал best-effort */ } }
}

// Durable-персист сгенерённых клипов в наш бакет + каталог (content_assets). КОРЕНЬ: i2v-клипы (seedance/kling/
// pika) живут на fal.media — эфемерное CDN fal → reel-recompose/ре-кат «потом» не из чего делать, когда URL
// протухнет. Здесь скачиваем каждый внешний клип в factory-media/clips/<sha1>.mp4, ПОДМЕНЯЕМ node.url на наш
// (бонус: VM рендерит из нашего бакета, не с fal → надёжнее, как rehost фото) и заводим строку content_assets
// (disk=gen, kind=clip — библиотека по артикулу/нише). Best-effort+идемпотентно (дедуп по source_url): любой
// сбой → клип остаётся на fal (пайплайн не падает). disk_real/уже-наши URL пропускаем.
const CLIP_BUCKET = "factory-media";
export async function persistClips(db: SupabaseClient, nodes: RunNode[], article: string, niche: string, recipeId?: number): Promise<void> {
  await Promise.all(nodes.map(async (n) => {
    const src = n.url;
    if (!src || !/^https?:\/\//i.test(src) || isOurStorage(src)) return; // пусто/не-http/уже у нас
    try {
      const { data: dup } = await db.from("content_assets").select("url").eq("disk", "gen").contains("analysis", { source_url: src }).maybeSingle();
      if (dup && (dup as { url?: string }).url) {
        const durable = (dup as { url: string }).url;
        n.url = durable;
        await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: durable, status: "generated", source: "graph_run", reason: "clip_library_dedupe", niche, article });
        return;
      } // уже сохранён — переиспользуем durable
      const r = await fetch(src, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!r.ok) {
        await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: null, artifact_ok: false, status: "artifact_fail", source: "graph_run", reason: `clip fetch ${r.status}`, niche, article });
        return;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) {
        await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: null, artifact_ok: false, status: "artifact_fail", source: "graph_run", reason: "clip fetch empty", niche, article });
        return;
      }
      const path = `clips/${createHash("sha1").update(src).digest("hex")}.mp4`;
      const { error } = await db.storage.from(CLIP_BUCKET).upload(path, buf, { contentType: "video/mp4", upsert: true, cacheControl: "31536000" });
      if (error) {
        await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: null, artifact_ok: false, status: "artifact_fail", source: "graph_run", reason: `clip upload: ${error.message}`.slice(0, 160), niche, article });
        return;
      }
      const pub = db.storage.from(CLIP_BUCKET).getPublicUrl(path).data?.publicUrl;
      if (!pub) {
        await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: null, artifact_ok: false, status: "artifact_fail", source: "graph_run", reason: "clip publicUrl missing", niche, article });
        return;
      }
      n.url = pub; // рендерим из durable-URL — ставим ДО insert: если каталожная вставка упадёт, клип уже в нашем бакете и рендер не вернётся на эфемерный fal-URL
      await db.from("content_assets").insert({ disk: "gen", path, name: `${article || "clip"} · clip ${roleOf(n) || ""}`.slice(0, 120), kind: "clip", niche: niche || null, article: article || null, color: null, url: pub, analyzed: true, analysis: { source_url: src, role: roleOf(n), tool: n.tool || null, source: "clip_library" } });
      await logGeneration({ recipe_id: recipeId ?? null, tool: n.tool, engine: n.engine, node_type: n.node_type, prompt: n.prompt, input_url: src, output_url: pub, status: "generated", source: "graph_run", reason: "clip_library", niche, article });
    } catch { /* best-effort — теряем клип на fal, но пайплайн жив */ }
  }));
}

// Захват рецепта на исполнение: status=running, активный шаг, свободный лиз.
export async function claimNextRecipe(db: SupabaseClient, recipeId?: number): Promise<{ id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string } | null> {
  // вариант Б (#3): атомарный claim через RPC claim_recipe — jsonb_set ставит ТОЛЬКО лиз, FOR UPDATE SKIP
  // LOCKED не даёт двум тикам взять одну строку, run_plan не переписывается целиком (стейл-перезапись
  // токенов/нод невозможна). Fallback на JS-CAS ниже, если RPC ещё не задеплоен (миграция 20260626 не
  // применена) → поведение полностью как раньше.
  try {
    const { data: rpcData, error: rpcErr } = await db.rpc("claim_recipe", { p_recipe_id: recipeId ?? null, p_lease_ms: LEASE_MS });
    if (!rpcErr) {
      const row = (Array.isArray(rpcData) ? rpcData[0] : null) as Record<string, unknown> | null;
      if (!row) return null; // RPC сработал, захватывать нечего
      const plan = (row.run_plan as RunPlan) || null;
      if (!plan || plan.step === "done" || plan.step === "failed") return null;
      return { id: Number(row.id), plan, article: String(row.article || ""), niche: String(row.niche || ""), mode: String(row.mode || "audience") };
    }
    // rpcErr → функции нет (миграция не применена) → падаем в JS-CAS
  } catch { /* fallback на JS-CAS */ }
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
    // захватили бы ОДИН рецепт = двойная оплата fal/creatify. Пропускаем — следующий tick/cron fallback подхватит.
    if (wErr) continue;
    if (!won) continue; // гонку проиграли — рецепт уже захватил другой тик
    return { id: row.id as number, plan, article: String(row.article || ""), niche: String(row.niche || ""), mode: String(row.mode || "audience") };
  }
  return null;
}

async function jpost(origin: string, path: string, body: unknown, ms = 90000): Promise<any> {
  const r = await withTimeout(
    internalFetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    }),
    ms,
    path,
  );
  const j = await withTimeout(r.json().catch(() => ({})), Math.max(5000, Math.floor(ms / 2)), `${path} json`);
  if (!r.ok) throw new Error(`${path} ${r.status}: ${String(j?.error || j?.detail || r.statusText || "ошибка").slice(0, 180)}`);
  return j;
}

// ОДИН шаг исполнения графа.
export async function runRecipeStep(
  db: SupabaseClient, origin: string,
  ctx: { id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string },
): Promise<void> {
  const { id, plan, article, niche, mode } = ctx;
  plan.lease_until = null; // снимаем лиз в начале — повторный заход разрешён после сохранения
  if (!plan.run_id) plan.run_id = makeRunId(id);

  const step = String(plan.step || "unknown");
  const inputArtifact = (() => {
    const nodes = plan.nodes || [];
    if (step === "autofill") return `nodes=${nodes.length}`;
    if (step === "submit") return nodes.map((n) => `${n.ordinal}:${String(n.tool || "none")}`).join(",").slice(0, 240);
    if (step === "gen-poll") {
      const submitted = nodes.filter((n) => n.status === "submitted").length;
      const done = nodes.filter((n) => n.status === "done").length;
      return `submitted=${submitted};done=${done}`;
    }
    if (step === "assemble") return `visual=${nodes.filter((n) => n.status === "done" && n.url).length};engine=${plan.render_engine || "shotstack"}`;
    if (step === "render-submit") return `engine=${plan.render_engine || "shotstack"};render=${plan.render_id || "new"}`;
    if (step === "render-poll") return `render=${plan.render_id || "none"}`;
    if (step === "otk") return `output=${plan.output_url || "none"}`;
    if (step === "bank") return `output=${plan.bestUrl || plan.output_url || "none"}`;
    return `step=${step}`;
  })();
  const trace = startExecutionLog(plan, step, inputArtifact);
  const addWarning = (msg: string) => {
    const next = new Set(plan.warnings || []);
    next.add(msg.slice(0, 240));
    plan.warnings = Array.from(next).slice(0, 20);
  };

  // ── autofill (V21): черновик-рецепт из батча сам конфигурируется (§17 ИИ-режиссёр) ПЕРЕД генерацией ──
  // Один тик = autofill (~45с Claude, влезает в 60с), затем перечитываем заполненные ноды и идём в submit.
  // human_edited-ноды autofill не трогает (force=false) → ручная настройка сохраняется. Best-effort: фейл → submit как есть.
  if (plan.step === "autofill") {
    // ИДЕМПОТЕНТНОСТЬ (DB-state, переживает ретраи шага): зовём Claude ТОЛЬКО если рецепт ещё не сконфигурён.
    // Уже настроенный (ai_autofilled/human_chosen + tool) → пропускаем платный вызов, сразу в submit.
    const { data: cur } = await db.from("node_recipe_nodes").select("tool,source").eq("recipe_id", id);
    const needsFill = ((cur as any[]) || []).some((n) => !n.tool || (n.source !== "ai_autofilled" && n.source !== "human_chosen"));
    if (needsFill) {
      try {
        const r = await jpost(origin, "/api/factory/autofill", { recipe_id: id }, 90000);
        await logSignal(db, "batch_autofill", { recipe_id: id, niche, article: article || null, params: { filled: r?.filled ?? null, byTool: r?.byTool ?? null } });
      } catch { /* автозаполнение best-effort — пойдём с тем, что есть */ }
    }
    // перечитываем ноды с заполненными tool/params/prompt и пересобираем СПИСОК нод (счётчики прогона не трогаем)
    const { data } = await db.from("node_recipe_nodes").select("ordinal,slot,node_type,tool,prompt,params,asset_url,duration_sec,agent_suggestion").eq("recipe_id", id).order("ordinal");
    plan.nodes = buildRunPlan((data as any[]) || []).nodes;
    plan.step = "submit";
    finishExecutionLog(plan, trace, "done", "submit", null, "autofill→submit");
    await savePlan(db, id, plan, { status: "running" });
    return;
  }

  // ── submit: разослать генеративные ноды на их движки ──
  if (plan.step === "submit") {
    const renderCount = (plan.renderCount || 0) + 1;
    if (renderCount > MAX_RENDERS) throw new Error("превышен лимит запусков генерации графа — стоп для бюджета");
    // авто-привязка ассетов товара к нодам без источника (фикс пустого автопилота, см. assetBind.ts)
    await autoBindAssets(db, plan, article, niche);
    plan.renderCount = renderCount; // фиксируем счётчик рендеров СРАЗУ (вместе с токенами), а не после цикла
    // держим лиз ВО ВРЕМЯ серийного сабмита: мид-луп savePlan персистит токены fal/creatify по каждой ноде
    // сразу после получения. Если хендлер убьют/лиз протухнет в середине — повторный заход видит ноду уже
    // submitted+token (guard ниже) и НЕ пересабмитит = нет двойной оплаты. Лиз future блокирует конкурентный claim.
    plan.lease_until = new Date(Date.now() + LEASE_MS).toISOString();
    for (const n of plan.nodes) {
      const tool = String(n.tool || "").toLowerCase();
      if (!tool || ASSEMBLY_TOOLS.has(tool) || tool === "captions") { n.status = "skip"; continue; }
      if (tool === "elevenlabs" && !speechReady()) {
        n.status = "skip";
        n.engine = "voice";
        n.error = undefined;
        continue;
      }
      if (n.status === "done" || n.status === "submitted") continue; // идемпотентность: уже отправлено (токен в БД) — не платим повторно
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
      await savePlan(db, id, plan); // ПЕРСИСТ ТОКЕНА сразу после сабмита ноды → защита от двойного сабмита при убийстве хендлера
    }
    plan.step = "gen-poll"; plan.pollCount = 0;
    plan.lease_until = null; // шаг завершён — освобождаем лиз для следующего тика (gen-poll)
    finishExecutionLog(plan, trace, "done", `submitted=${plan.nodes.filter((n) => n.status === "submitted").length}`, null, "submit→gen-poll");
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
      finishExecutionLog(plan, trace, "running", `submitted=${stillPending.length}`, null, "gen-poll waiting");
      await savePlan(db, id, plan, { status: "running" });
      return;
    }
    // таймаут оставшихся → помечаем error, идём дальше с тем, что готово
    for (const n of stillPending) { n.status = "error"; n.error = "render timeout"; }
    // ни одна нода не готова → фейлим СРАЗУ с причинами нод (раньше шли в assemble → throw «нет клипов»
    // → 3 ретрая шага → run_fail без деталей; теперь оператор видит, КАКИЕ ноды и ПОЧЕМУ упали)
    const anyDone = plan.nodes.some((n) => n.status === "done" && n.url);
    if (!anyDone) {
      const errs = plan.nodes.filter((n) => n.status === "error")
        .map((n) => `${n.node_type || n.slot || "нода"}: ${n.error || "?"}`).slice(0, 6).join("; ");
      plan.step = "failed";
      plan.error = "все ноды генерации упали — " + (errs || "без деталей");
      finishExecutionLog(plan, trace, "error", null, plan.error, "gen-poll failed");
      await savePlan(db, id, plan, { status: "run_fail" });
      return;
    }
    plan.step = "assemble";
    finishExecutionLog(plan, trace, "done", `done=${plan.nodes.filter((n) => n.status === "done" && n.url).length}`, null, "gen-poll→assemble");
    await savePlan(db, id, plan);
    return;
  }

  // ── assemble: смонтировать готовые клипы через Shotstack ──
  if (plan.step === "assemble") {
    // role="skip" (инспектор disk_real) → выкинуть клип из сборки; elevenlabs — это АУДИО (закадр), не визуал
    const visualNodes = plan.nodes.filter((n) => n.status === "done" && n.url && n.node_type !== "captions" && String(n.tool).toLowerCase() !== "elevenlabs" && String(((n.params || {}) as Record<string, unknown>)["role"] || "").toLowerCase() !== "skip");
    plan.backup_url = visualNodes[0]?.url || null;
    if (!visualNodes.length) {
      const msg = "нет готовых клипов для сборки (все ноды упали — проверь image_url/ключи)";
      finishExecutionLog(plan, trace, "error", null, msg, "assemble");
      throw new Error(msg);
    }

    // durable-персист клипов в наш бакет (fal.media эфемерно) → библиотека для ре-ката + надёжный рендер.
    // ДО сборки пропсов: подменит node.url на наш, и render/shotstack пойдут уже с durable-URL. Best-effort.
    await persistClips(db, visualNodes, article, niche, id);

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
    const hookText = textOfNode(hookNode).slice(0, 120) || undefined;
    const captionNode = plan.nodes.find((n) => n.node_type === "captions");
    const caption = (textOfNode(captionNode) || (article ? "Ищи на WB: " + article : "")).toString().slice(0, 120) || undefined;
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
    (plan as any).edit_json = edit;

    // ── V23 · движок REMOTION (премиум ReelV5) — опт-ин FACTORY_RENDER_ENGINE=remotion.
    // Shotstack edit_json всё равно сохраняем выше: если Remotion дорендерил, но не смог залить в storage,
    // render-poll может переключиться на Shotstack-сборку вместо деградации до raw clip.
    if (remotionEngineSelected()) {
      if (remotionReady()) {
        const { inputProps, durationInFrames } = buildReelProps(plan, visualNodes, article);
        plan.reel_props = inputProps;
        plan.duration_frames = durationInFrames;
        plan.render_engine = "remotion";
        plan.step = "render-submit";
        finishExecutionLog(plan, trace, "done", "render-submit", null, "assemble→render-submit(remotion)");
        await savePlan(db, id, plan);
        return;
      }
      addWarning("remotion выбран, но сервис не готов; используем Shotstack");
    }

    // одиночный клип без Shotstack → используем как есть (минуем рендер)
    if (visualNodes.length === 1 && !shotstackReady()) {
      plan.output_url = visualNodes[0].url!;
      plan.step = "otk";
      finishExecutionLog(plan, trace, "warning", plan.output_url, null, "single clip fallback");
      await savePlan(db, id, plan, { output_url: plan.output_url });
      return;
    }
    if (!shotstackReady()) {
      // нет монтажника и клипов несколько — берём первый (деградация), отметим
      plan.output_url = visualNodes[0].url!;
      plan.error = "SHOTSTACK_API_KEY не задан — взят первый клип без монтажа";
      plan.step = "otk";
      finishExecutionLog(plan, trace, "warning", plan.output_url, null, "shotstack missing");
      await savePlan(db, id, plan, { output_url: plan.output_url });
      return;
    }

    plan.step = "render-submit";
    finishExecutionLog(plan, trace, "done", "render-submit", null, summarizeWarnings(plan) || undefined);
    await savePlan(db, id, plan);
    return;
  }

  // ── render-submit: запустить рендер (Remotion VM или Shotstack) ──
  if (plan.step === "render-submit") {
    if (plan.render_id) {
      plan.step = "render-poll"; plan.pollCount = 0;
      finishExecutionLog(plan, trace, "running", `render=${plan.render_id}`, null, "render already started");
      await savePlan(db, id, plan, { status: "running" });
      return;
    }
    if (plan.render_engine === "remotion") {
      const renderId = await remotionSubmit("ReelV5", plan.reel_props || {}, plan.duration_frames || undefined);
      if (!renderId) {
        if (plan.backup_url) {
          const warn = "remotionSubmit вернул null; fallback raw clip";
          addWarning(warn);
          plan.output_url = plan.backup_url;
          plan.step = "otk";
          finishExecutionLog(plan, trace, "warning", plan.backup_url, null, warn);
          await savePlan(db, id, plan, { output_url: plan.backup_url, status: "running" });
          return;
        }
        const msg = "remotionSubmit вернул null — проверь REMOTION_RENDER_URL/REMOTION_RENDER_TOKEN/живость VM";
        finishExecutionLog(plan, trace, "error", null, msg, "render-submit");
        throw new Error(msg);
      }
      plan.render_id = renderId; plan.step = "render-poll"; plan.pollCount = 0;
      finishExecutionLog(plan, trace, "done", `render=${renderId}`, null, "render-submit→render-poll");
      await savePlan(db, id, plan, { render_id: renderId, status: "running" });
      return;
    }
    const edit = (plan as any).edit_json as Record<string, unknown>;
    if (!edit) {
      if (plan.backup_url) {
        const warn = "нет edit_json; fallback raw clip";
        addWarning(warn);
        plan.output_url = plan.backup_url;
        plan.step = "otk";
        finishExecutionLog(plan, trace, "warning", plan.backup_url, null, warn);
        await savePlan(db, id, plan, { output_url: plan.backup_url, status: "running" });
        return;
      }
      const msg = "нет edit_json для рендера";
      finishExecutionLog(plan, trace, "error", null, msg, "render-submit");
      throw new Error(msg);
    }
    const renderId = await shotstackSubmit(edit);
    if (!renderId) {
      if (plan.backup_url) {
        const warn = "shotstackSubmit вернул null; fallback raw clip";
        addWarning(warn);
        plan.output_url = plan.backup_url;
        plan.step = "otk";
        finishExecutionLog(plan, trace, "warning", plan.backup_url, null, warn);
        await savePlan(db, id, plan, { output_url: plan.backup_url, status: "running" });
        return;
      }
      const msg = "shotstackSubmit вернул null — проверь SHOTSTACK_API_KEY/схему";
      finishExecutionLog(plan, trace, "error", null, msg, "render-submit");
      throw new Error(msg);
    }
    plan.render_id = renderId; plan.step = "render-poll"; plan.pollCount = 0;
    finishExecutionLog(plan, trace, "done", `render=${renderId}`, null, "render-submit→render-poll");
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
      finishExecutionLog(plan, trace, "done", s.videoUrl, null, "render complete");
      await savePlan(db, id, plan, { output_url: s.videoUrl });
    } else if (s.status === "error" && s.retryable !== true) {
      if (plan.render_engine === "remotion" && (plan as any).edit_json && shotstackReady()) {
        const warn = `${engineName} error: ${(s.error || "unknown").slice(0, 120)}; fallback Shotstack`;
        addWarning(warn);
        plan.render_engine = "shotstack";
        plan.render_id = null;
        plan.pollCount = 0;
        plan.step = "render-submit";
        finishExecutionLog(plan, trace, "warning", "render-submit", null, warn);
        await savePlan(db, id, plan, { status: "running" });
        return;
      }
      // Если есть запасной клип, не рвём прогон: сохраняем raw fallback и идём дальше с warning.
      if (plan.backup_url) {
        const warn = `${engineName} error: ${(s.error || "unknown").slice(0, 120)}; fallback raw clip`;
        addWarning(warn);
        plan.output_url = plan.backup_url;
        plan.step = "otk";
        finishExecutionLog(plan, trace, "warning", plan.backup_url, null, warn);
        await savePlan(db, id, plan, { output_url: plan.backup_url, status: "running" });
      } else {
        const msg = `${engineName} error: ` + (s.error || "unknown");
        finishExecutionLog(plan, trace, "error", null, msg, "render-poll");
        throw new Error(msg);
      }
    } else if (pollCount >= MAX_POLLS) {
      if (plan.backup_url) {
        const warn = `${engineName} render timeout` + (s.status === "error" ? ` (последний опрос: ${s.error})` : "") + "; fallback raw clip";
        addWarning(warn);
        plan.output_url = plan.backup_url;
        plan.step = "otk";
        finishExecutionLog(plan, trace, "warning", plan.backup_url, null, warn);
        await savePlan(db, id, plan, { output_url: plan.backup_url, status: "running" });
      } else {
        const msg = `${engineName} render timeout` + (s.status === "error" ? ` (последний опрос: ${s.error})` : "");
        finishExecutionLog(plan, trace, "error", null, msg, "render-poll");
        throw new Error(msg);
      }
    } else {
      plan.pollCount = pollCount;
      finishExecutionLog(plan, trace, "running", `render=${plan.render_id || "none"}`, null, "render-poll waiting");
      await savePlan(db, id, plan, { status: "running" });
    }
    return;
  }

  // ── otk: кадры → видео-критик → вердикт ──
  if (plan.step === "otk") {
    const url = plan.output_url;
    if (!url) {
      const msg = "нет output_url для ОТК";
      finishExecutionLog(plan, trace, "error", null, msg, "otk");
      throw new Error(msg);
    }
    let frames: string[] = [];
    try {
      frames = await extractFrames(url);
    } catch (e) {
      addWarning(`extractFrames failed: ${String((e as Error)?.message || e).slice(0, 120)}`);
    }
    if (!frames.length) addWarning("ОТК не извлёк кадры; сохраняем ролик без оценки");

    let artifactOk = true;
    let artifactDefects: string[] = [];
    if (frames.length) {
      try {
        const art = await jpost(origin, "/api/factory/artifact-check", { frames }, 45000);
        artifactOk = art?.ok !== false;
        artifactDefects = Array.isArray(art?.defects) ? art.defects.map((d: unknown) => String(d).slice(0, 120)).slice(0, 5) : [];
        if (!artifactOk) addWarning(`artifact-check warning: ${artifactDefects.join(", ") || "broken"}`);
      } catch (e) {
        artifactOk = false;
        addWarning(`artifact-check unavailable: ${String((e as Error)?.message || e).slice(0, 120)}`);
      }
    }

    const hookNode = plan.nodes.find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || plan.nodes[0];
    let score: number | null = null;
    let verdict: string | undefined;
    let axes: unknown = null;
    let issues: string[] = [];
    let basis: string | null = null;
    let basisReason: string | null = null;
    let criticResponse: unknown = null;
    try {
      const v = frames.length ? await jpost(origin, "/api/factory/video-critic", { frames, hook: textOfNode(hookNode), mode, article, niche }, 55000) : null;
      criticResponse = v;
      score = typeof v?.score === "number" ? v.score : null;
      verdict = v?.verdict;
      axes = v?.axes || null;
      issues = Array.isArray(v?.issues) ? v.issues : [];
      basis = v?.basis ? String(v.basis) : null;
      basisReason = v?.basis_reason ? String(v.basis_reason) : null;
    } catch (e) {
      addWarning(`video-critic unavailable: ${String((e as Error)?.message || e).slice(0, 120)}`);
    }

    if (score == null) {
      const responseShape = criticResponse && typeof criticResponse === "object"
        ? Object.keys(criticResponse as Record<string, unknown>).slice(0, 8).join(",") || "empty_object"
        : criticResponse === null ? "null" : typeof criticResponse;
      const fallback = graphRunOtkFallback({
        mode,
        niche,
        article,
        productName: ctx.product_name,
        framesCount: frames.length,
        reason: frames.length ? `video-critic returned no numeric score (${responseShape})` : "extractFrames returned no frames",
      });
      score = fallback.score;
      verdict = fallback.verdict;
      axes = fallback.axes;
      issues = [...issues, ...fallback.issues];
      basis = fallback.basis;
      basisReason = fallback.basisReason;
      addWarning(`video-critic fallback score used: ${fallback.basisReason}`);
    }
    if (typeof score === "number" && score < 7) addWarning(`OTK below threshold: ${score}`);
    plan.otk = { score, verdict, axes, issues, basis, basis_reason: basisReason };
    if (score != null && score > (plan.bestScore ?? -1)) { plan.bestScore = score; plan.bestUrl = url; }

    if (otkRegenEnabled() && (plan.renderCount || 0) < MAX_RENDERS) {
      if (!artifactOk) {
        const node = plan.nodes.find(isRegenerable);
        if (node) {
          finishExecutionLog(plan, trace, "warning", "submit", null, "artifact-check→regen");
          await regenCulprit(db, origin, id, plan, niche, article, node, artifactDefects, "Исправь визуальные артефакты, сохрани товар стабильным и не меняй структуру ролика.", "artifact_check_failed", true);
          return;
        }
      }
      if (typeof score === "number" && score < 7) {
        const culprit = pickCulprit(plan, axes);
        if (culprit) {
          finishExecutionLog(plan, trace, "warning", "submit", null, `otk→regen ${culprit.axis}`);
          await regenCulprit(db, origin, id, plan, niche, article, culprit.node, issues, `Усиль ось ${culprit.axis}; исправь слабое место без смены товара и общего сюжета.`, `otk_${culprit.axis}_below_${culprit.val}`);
          return;
        }
      }
    }

    const status = summarizeWarnings(plan) ? "warning" : "done";
    plan.step = "bank";
    finishExecutionLog(plan, trace, status === "warning" ? "warning" : "done", url, null, status === "warning" ? summarizeWarnings(plan) : "otk→bank");
    await savePlan(db, id, plan, { otk_verdict: plan.otk, otk_score: score, status: "running" });
    return;
  }

  // ── bank: сохранить в библиотеку + финализировать рецепт + сигнал ──
  if (plan.step === "bank") {
    // V3: банкуем ЛУЧШУЮ сборку за все попытки реген-петли (а не последнюю, которая могла просесть)
    const url = plan.bestUrl || plan.output_url;
    const score = plan.bestScore != null ? plan.bestScore : (plan.otk?.score ?? null);
    const hookNode = plan.nodes.find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || plan.nodes[0];
    const hook = textOfNode(hookNode).slice(0, 200);
    // в библиотеку контента (каталог кокпита)
    let catalogUrl: string | null = null;
    let catalogError: string | null = null;
    if (url) {
      try {
        const g = await jpost(origin, "/api/factory/gen-save", { video_url: url, article, niche, hook, route: "node_graph", engine: plan.render_engine || "shotstack", otk: score, otk_axes: plan.otk?.axes ?? null, recipe_id: id }, 40000); // ≤40с: влезть в maxDuration 60 тика (был 120с → Vercel убивал handler, catalogUrl терялся)
        catalogUrl = g?.url || null;
      } catch (e) { catalogError = String((e as Error)?.message || e).slice(0, 220); }
    }
    if (url && !catalogUrl && catalogError) {
      addWarning(`gen-save warning: ${catalogError}`);
    }
    const qualityStatus = score != null && score >= 7 ? "otk_pass" : "warning";
    const finalStatus = summarizeWarnings(plan) ? "warning" : qualityStatus;
    plan.step = "done";
    plan.catalog_url = catalogUrl;
    plan.catalog_error = catalogError;
    if (url && !catalogUrl && catalogError) {
      await logSignal(db, "catalog_save_failed", {
        recipe_id: id, niche, article, mode, format: null, engine: plan.render_engine || "shotstack",
        params: { source: "graph_run_bank", raw_url: url, error: catalogError },
      });
    }
    await logSignal(db, finalStatus === "otk_pass" ? "approved" : "approved", {
      recipe_id: id, niche, article, mode, format: null, engine: plan.render_engine || "shotstack",
      axes: plan.otk?.axes ?? null, reason_chip: finalStatus === "warning" ? (plan.warnings?.[0] || "warning") : null,
    });
    // V21/R5: батч-прогон прошёл ОТК → шлём оператору в Telegram на ревью (студийные прогоны — нет, без спама)
    if (plan.notify && finalStatus === "otk_pass" && (catalogUrl || url) && tgReady()) {
      try { await tgSendReview((catalogUrl || url)!, `${hook || article || "генерация"}\nОТК ${score != null ? Math.round(score * 10) : "—"}/100 · ниша ${niche}`, id); } catch { /* telegram опционален */ }
    }
    finishExecutionLog(plan, trace, finalStatus === "warning" ? "warning" : "done", catalogUrl || url || null, null, summarizeWarnings(plan) || "bank");
    await savePlan(db, id, plan, {
      status: finalStatus,
      output_url: catalogUrl || url || null,
      otk_verdict: plan.otk ?? null,
      otk_score: score,
    });
    return;
  }
}

export async function advanceClaimedRecipe(
  db: SupabaseClient,
  origin: string,
  ctx: { id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string },
): Promise<{ ok: boolean; error: string | null; terminal: boolean; step: RunPlan["step"] }> {
  let crashed = false;
  let errorMessage: string | null = null;
  try {
    await runRecipeStep(db, origin, ctx);
    const p = ctx.plan as RunPlan;
    if (p.attempts) {
      p.attempts = 0;
      const { error: rErr } = await db.rpc("reset_step_attempts", { p_recipe_id: ctx.id });
      if (rErr) {
        await db.from("node_recipes").update({ run_plan: p, updated_at: new Date().toISOString() }).eq("id", ctx.id);
      }
    }
  } catch (e) {
    crashed = true;
    errorMessage = String(e instanceof Error ? e.message : e).slice(0, 300);
    const plan = ctx.plan as RunPlan;
    const attempts = (plan.attempts || 0) + 1;
    plan.attempts = attempts;
    plan.error = errorMessage;
    plan.lease_until = null;
    if (attempts >= MAX_STEP_ATTEMPTS) {
      plan.step = "failed";
      await db.from("node_recipes").update({ run_plan: plan, status: "run_fail", updated_at: new Date().toISOString() }).eq("id", ctx.id);
    } else {
      await db.from("node_recipes").update({ run_plan: plan, updated_at: new Date().toISOString() }).eq("id", ctx.id);
    }
  }
  const currentStep = ctx.plan.step;
  const terminal = currentStep === "done" || currentStep === "failed";
  return { ok: !crashed, error: errorMessage, terminal, step: currentStep };
}
