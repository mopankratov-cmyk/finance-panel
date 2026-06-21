import type { SupabaseClient } from "@supabase/supabase-js";
import { submitNode, pollNode, type EngineNode } from "./nodeEngine";
import { buildEdit, fixedBeatGrid, quantizeToBeats, shotstackSubmit, shotstackStatus, shotstackReady, type AssemblyClip } from "./shotstack";
import { extractFrames } from "./serverMedia";

// V3 исполнитель графа: рецепт (node_recipe_nodes) → генерация нод → Shotstack-сборка → ОТК → банк.
// Self-chaining машина по образцу jobs/tick: один тик = ОДИН шаг (<60с), состояние в node_recipes.run_plan.
// Платные шаги (fal/creatify/shotstack) защищены счётчиками; лиз бережёт от двойной обработки.

export type RunStep = "submit" | "gen-poll" | "assemble" | "render-submit" | "render-poll" | "otk" | "bank" | "done" | "failed";

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
      duration_sec: typeof r.duration_sec === "number" ? r.duration_sec : null,
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
    // best-effort захват: ставим лиз
    plan.lease_until = leaseIso;
    await db.from("node_recipes").update({ run_plan: plan, updated_at: nowIso }).eq("id", row.id);
    return { id: row.id as number, plan, article: String(row.article || ""), niche: String(row.niche || ""), mode: String(row.mode || "audience") };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jpost(origin: string, path: string, body: unknown, ms = 90000): Promise<any> {
  const r = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return r.json().catch(() => ({}));
}

// ОДИН шаг исполнения графа.
export async function runRecipeStep(
  db: SupabaseClient, origin: string,
  ctx: { id: number; plan: RunPlan; article: string; niche: string; mode: string; product_name?: string },
): Promise<void> {
  const { id, plan, article, niche, mode } = ctx;
  plan.lease_until = null; // снимаем лиз в начале — повторный заход разрешён после сохранения

  // ── submit: разослать генеративные ноды на их движки ──
  if (plan.step === "submit") {
    const renderCount = (plan.renderCount || 0) + 1;
    if (renderCount > MAX_RENDERS) throw new Error("превышен лимит запусков генерации графа — стоп для бюджета");
    for (const n of plan.nodes) {
      const tool = String(n.tool || "").toLowerCase();
      if (!tool || ASSEMBLY_TOOLS.has(tool) || tool === "captions") { n.status = "skip"; continue; }
      if (n.status === "done" || n.status === "submitted") continue;
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
    const visualNodes = plan.nodes.filter((n) => n.status === "done" && n.url && n.node_type !== "captions");
    if (!visualNodes.length) throw new Error("нет готовых клипов для сборки (все ноды упали — проверь image_url/ключи)");

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

    // раскладка по таймлайну: видео-ноды последовательно, длительность из ноды
    let t = 0;
    const raw: AssemblyClip[] = visualNodes.map((n, i) => {
      const len = Math.min(8, Math.max(2, Number(n.duration_sec) || 5));
      const clip: AssemblyClip = { url: n.url!, type: "video", start: t, length: len };
      if (i > 0) clip.transition = "fade";
      t += len;
      return clip;
    });
    const total = Math.max(5, t);
    const clips = quantizeToBeats(raw, fixedBeatGrid(120, total));

    const hookNode = plan.nodes.find((n) => n.slot === "hook") || plan.nodes[0];
    const hookText = (hookNode?.onscreen_text || "").toString().slice(0, 120) || undefined;
    const captionNode = plan.nodes.find((n) => n.node_type === "captions");
    const caption = (captionNode?.onscreen_text || (article ? "Ищи на WB: " + article : "")).toString().slice(0, 120) || undefined;
    const soundNode = plan.nodes.find((n) => String(n.tool).toLowerCase() === "sound" || String(n.tool).toLowerCase() === "music");
    const audioUrl = (soundNode?.asset_url || (soundNode?.params?.url as string) || "") || undefined;
    const fontUrl = (process.env.SHOTSTACK_FONT_URL || "").trim() || undefined;
    const fontFamily = (process.env.SHOTSTACK_FONT_FAMILY || "").trim() || undefined;

    const edit = buildEdit({ clips, hookText, caption, audioUrl, fontUrl, fontFamily, aspect: "9:16" });
    // сохраним edit в run_plan для воспроизводимости
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plan as any).edit_json = edit;
    plan.step = "render-submit";
    await savePlan(db, id, plan);
    return;
  }

  // ── render-submit: запустить Shotstack ──
  if (plan.step === "render-submit") {
    if (plan.render_id) { plan.step = "render-poll"; plan.pollCount = 0; await savePlan(db, id, plan, { status: "running" }); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edit = (plan as any).edit_json as Record<string, unknown>;
    if (!edit) throw new Error("нет edit_json для рендера");
    const renderId = await shotstackSubmit(edit);
    if (!renderId) throw new Error("shotstackSubmit вернул null — проверь SHOTSTACK_API_KEY/схему");
    plan.render_id = renderId; plan.step = "render-poll"; plan.pollCount = 0;
    await savePlan(db, id, plan, { render_id: renderId, status: "running" });
    return;
  }

  // ── render-poll: ждать Shotstack ──
  if (plan.step === "render-poll") {
    await sleep(POLL_WAIT_MS);
    const pollCount = (plan.pollCount || 0) + 1;
    const s = await shotstackStatus(String(plan.render_id));
    if (s.status === "done" && s.videoUrl) {
      plan.output_url = s.videoUrl; plan.step = "otk";
      await savePlan(db, id, plan, { output_url: s.videoUrl });
    } else if (s.status === "error") {
      throw new Error("Shotstack error: " + (s.error || "unknown"));
    } else if (pollCount >= MAX_POLLS) {
      throw new Error("Shotstack render timeout");
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
    const hookNode = plan.nodes.find((n) => n.slot === "hook") || plan.nodes[0];
    const v = await jpost(origin, "/api/factory/video-critic", { frames, hook: hookNode?.onscreen_text || hookNode?.prompt || "", mode, article, niche }, 55000);
    const score = typeof v?.score === "number" ? v.score : null;
    plan.otk = { score, verdict: v?.verdict, axes: v?.axes || null, issues: Array.isArray(v?.issues) ? v.issues : [] };
    plan.step = "bank";
    await savePlan(db, id, plan, { otk_verdict: plan.otk, otk_score: score });
    return;
  }

  // ── bank: сохранить в библиотеку + финализировать рецепт + сигнал ──
  if (plan.step === "bank") {
    const url = plan.output_url;
    const score = plan.otk?.score ?? null;
    const hookNode = plan.nodes.find((n) => n.slot === "hook") || plan.nodes[0];
    const hook = (hookNode?.onscreen_text || hookNode?.prompt || "").toString().slice(0, 200);
    // в библиотеку контента (каталог кокпита)
    let catalogUrl: string | null = null;
    if (url) {
      try {
        const g = await jpost(origin, "/api/factory/gen-save", { video_url: url, article, niche, hook, route: "node_graph", engine: "shotstack", otk: score }, 120000);
        catalogUrl = g?.url || null;
      } catch { /* банк библиотеки опционален */ }
    }
    const status = score == null ? "otk_pass" : score >= 7 ? "otk_pass" : "otk_fail";
    plan.step = "done";
    await savePlan(db, id, plan, { status, output_url: catalogUrl || url || null });
    await logSignal(db, status === "otk_pass" ? "approved" : "rejected", {
      recipe_id: id, niche, article, mode, format: null, engine: "shotstack",
      axes: plan.otk?.axes ?? null, reason_chip: status === "otk_fail" ? (plan.otk?.issues?.[0] || "ОТК<7") : null,
    });
    return;
  }
}
