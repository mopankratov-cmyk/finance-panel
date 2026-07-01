import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getBestProductTwinAsset, getLatestProductTwinByArticle, getProductTwinViewAssets } from "@/lib/factory/productTwinStore";
import { buildProductBrollPlan, type ProductBrollRecipe } from "@/lib/factory/productBrollBatch";
import { extractFrames } from "@/lib/factory/serverMedia";
import { runArtifactCheck } from "@/lib/factory/qaGates";
import { falVideoStatus } from "@/lib/factory/falVideo";
import { archiveExternalMediaToYandex } from "@/lib/factory/yandexArchive";
import {
  assessProductBrollQuality,
  buildProductBrollExperimentPlan,
  summarizeProductBrollFeedback,
  type ProductBrollRejectReason,
} from "@/lib/factory/productBrollLearning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type LoopAction = "plan" | "submit_one" | "judge" | "mark_reject";

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bool(value: unknown): boolean {
  return value === true || value === "1" || value === "true" || value === "yes";
}

function list(value: unknown): string[] {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

function reasons(value: unknown): ProductBrollRejectReason[] {
  if (Array.isArray(value)) return value.map((item) => text(item, 60)).filter(Boolean).slice(0, 8) as ProductBrollRejectReason[];
  return list(value).slice(0, 8) as ProductBrollRejectReason[];
}

function actionFrom(req: NextRequest, body: Record<string, unknown>): LoopAction {
  const raw = text(body.action || req.nextUrl.searchParams.get("action") || "plan", 30);
  return raw === "submit_one" || raw === "judge" || raw === "mark_reject" ? raw : "plan";
}

function preferredBrollView(views: Awaited<ReturnType<typeof getProductTwinViewAssets>>) {
  return views.find((view) => view.purpose === "lifestyle")
    || views.find((view) => /hand|use|table|front/i.test(view.viewId))
    || views.find((view) => view.truth === "derived_from_source")
    || views[0]
    || null;
}

async function candidate(input: { articles: string[]; article?: string }) {
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен" };
  const pool = input.article ? [input.article] : input.articles.length ? input.articles : ["YYS0101", "TT04102", "NV-08", "NV-836", "NV-816"];
  const inspected = [];
  for (const article of pool) {
    const twin = await getLatestProductTwinByArticle(db, article);
    if (!twin) {
      inspected.push({ article, status: "no_twin" });
      continue;
    }
    const views = await getProductTwinViewAssets(db, { article, twinId: twin.twinId, limit: 80 });
    const view = preferredBrollView(views);
    const pickedAsset = view ? null : await getBestProductTwinAsset(db, { twinId: twin.twinId, useCase: "broll" });
    const simple = twin.category === "cosmetics" || twin.category === "toy";
    inspected.push({
      article,
      category: twin.category,
      twin_id: twin.twinId,
      views: views.length,
      selected_view: view?.viewId || null,
      selected_asset_kind: pickedAsset?.asset.kind || null,
      selected_asset_quality: pickedAsset?.asset.qualityScore ?? null,
      selected_asset_risk: pickedAsset?.asset.risk || null,
      simple,
    });
    if (input.article || simple) return { twin, views, view, pickedAsset, inspected };
  }
  return { inspected, error: "нет простого cosmetics/toy twin; autonomous paid loop is held" };
}

async function callBatch(req: NextRequest, body: Record<string, unknown>) {
  const origin = req.nextUrl.origin;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  const auth = req.headers.get("authorization");
  if (cookie) headers.cookie = cookie;
  if (auth) headers.authorization = auth;
  const res = await fetch(`${origin}/api/factory/product-broll-batch`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(260_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function recordFeedback(input: {
  article: string;
  twinId?: string | null;
  assetId?: string | null;
  viewId?: string | null;
  taskId?: string | null;
  verdict: "winner" | "usable" | "weak" | "reject";
  reasons: ProductBrollRejectReason[];
  score?: number | null;
  note?: string | null;
  source: string;
}) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  let query = db.from("content_assets")
    .select("id,name,url,niche,article,analysis,created_at")
    .eq("disk", "product_twin")
    .eq("article", input.article)
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(160);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  const row = ((data || []) as Record<string, unknown>[]).find((candidateRow) => {
    const analysis = (candidateRow.analysis || {}) as Record<string, unknown>;
    const asset = (analysis.product_twin_asset || {}) as Record<string, unknown>;
    const view = (analysis.product_twin_view_asset || {}) as Record<string, unknown>;
    if (input.assetId && text(asset.asset_id, 180) === input.assetId) return true;
    if (input.viewId && text(view.view_id, 80) === input.viewId) return true;
    return false;
  }) || null;
  if (!row) return { ok: false, error: "product twin asset не найден" };

  const feedback = summarizeProductBrollFeedback({ verdict: input.verdict, reasons: input.reasons, score: input.score, note: input.note });
  const analysis = { ...((row.analysis || {}) as Record<string, unknown>) };
  const history = Array.isArray(analysis.product_broll_feedback) ? analysis.product_broll_feedback as unknown[] : [];
  analysis.product_broll_feedback = [{
    ...feedback,
    article: input.article,
    twin_id: input.twinId || null,
    asset_id: input.assetId || null,
    view_id: input.viewId || null,
    task_id: input.taskId || null,
    at: new Date().toISOString(),
    source: input.source,
  }, ...history].slice(0, 20);
  analysis.product_broll_learning = {
    last_verdict: feedback.verdict,
    last_score: feedback.score,
    last_reasons: feedback.reasons,
    next_action: feedback.next_action,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await db.from("content_assets").update({ analysis }).eq("id", row.id);
  if (updateError) return { ok: false, error: updateError.message };
  try {
    await db.from("cf_signals").insert({
      event: input.verdict === "winner" || input.verdict === "usable" ? "approved" : "rejected",
      reason_chip: (feedback.reasons[0] || feedback.verdict).slice(0, 80),
      niche: text(row.niche, 80) || null,
      article: input.article,
      mode: input.source,
    });
  } catch {
    // Optional learning signal.
  }
  return { ok: true, row_id: row.id, feedback };
}

async function insertGeneratedVideo(input: {
  article: string;
  niche?: string | null;
  videoUrl: string;
  yandexArchive: unknown;
  taskId: string;
  verdict: unknown;
  source: Record<string, unknown>;
}) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const path = `product-broll/${input.article}/${input.taskId}`;
  const { error } = await db.from("content_assets").insert({
    disk: "gen",
    path,
    name: `${input.article} product b-roll quality loop`,
    kind: "video",
    niche: input.niche || null,
    article: input.article,
    color: null,
    url: input.videoUrl,
    analyzed: true,
    analysis: {
      source: "product_broll_quality_loop",
      task_id: input.taskId,
      product_broll_source: input.source,
      product_broll_quality: input.verdict,
      yandex_archive: input.yandexArchive,
    },
  });
  return error ? { ok: false, error: error.message } : { ok: true, path };
}

async function handle(req: NextRequest, body: Record<string, unknown>) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const action = actionFrom(req, body);
  const sp = req.nextUrl.searchParams;
  const article = text(body.article || sp.get("article"), 80);
  const articles = list(body.articles || sp.get("articles"));
  const picked = await candidate({ articles, article: article || undefined });
  if ("error" in picked && !("twin" in picked)) {
    return NextResponse.json({ ok: false, action, error: picked.error, inspected: picked.inspected || [] }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const twin = picked.twin!;
  const view = picked.view;
  const pickedAsset = picked.pickedAsset || null;
  const recipe = (text(body.recipe || sp.get("recipe"), 40) || (twin.category === "toy" ? "toy_action" : "skincare_ritual")) as ProductBrollRecipe;
  const variants = buildProductBrollPlan({ article: twin.article, product: twin.productName, recipe, count: 1, model: "kling" });
  const plan = buildProductBrollExperimentPlan({
    article: twin.article,
    product: twin.productName,
    category: twin.category,
    recipe,
    model: "kling",
    variants,
    sourceKind: view ? "product_twin_view" : "product_twin_latest",
    assetKind: view ? "product_twin_view" : pickedAsset?.asset.kind || null,
    assetQuality: view ? null : pickedAsset?.asset.qualityScore ?? null,
    assetRisk: view ? "low" : pickedAsset?.asset.risk || null,
    viewId: view?.viewId || null,
    autonomous: true,
  });

  if (action === "plan") {
    return NextResponse.json({ ok: true, action, candidate: { article: twin.article, product: twin.productName, category: twin.category, twin_id: twin.twinId, view_id: view?.viewId || null, inspected: picked.inspected }, plan }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "mark_reject") {
    const feedback = await recordFeedback({
      article: twin.article,
      twinId: text(body.twin_id || body.twinId || sp.get("twin_id") || sp.get("twinId"), 140) || twin.twinId,
      assetId: text(body.asset_id || body.assetId || sp.get("asset_id") || sp.get("assetId"), 180) || view?.sourceAssetId || pickedAsset?.asset.assetId || null,
      viewId: text(body.view_id || body.viewId || sp.get("view_id") || sp.get("viewId"), 80) || view?.viewId || null,
      taskId: text(body.task_id || body.taskId || sp.get("task_id") || sp.get("taskId"), 180) || null,
      verdict: "reject",
      reasons: reasons(body.reasons || sp.get("reasons") || "identity_drift,artifact_detected"),
      score: 0,
      note: text(body.note || sp.get("note") || "operator corrected b-roll: invented product artifacts", 240),
      source: "product_broll_quality_loop_manual_reject",
    });
    return NextResponse.json({ ok: feedback.ok, action, feedback }, { status: feedback.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  }

  if (action === "submit_one") {
    if (plan.mode === "blocked" && !bool(body.force || sp.get("force"))) return NextResponse.json({ ok: false, action, mode: "blocked", candidate: { article: twin.article, category: twin.category, view_id: view?.viewId || null }, plan }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const submitted = await callBatch(req, {
      article: twin.article,
      product: twin.productName,
      recipe,
      model: "kling",
      count: 1,
      submit: true,
      use_derived_view: Boolean(view?.viewId),
      view_id: view?.viewId || undefined,
    });
    return NextResponse.json({ ok: submitted.status < 400 && submitted.json?.ok !== false, action, candidate: { article: twin.article, category: twin.category, view_id: view?.viewId || null }, plan, submit: submitted.json }, { status: submitted.status, headers: { "Cache-Control": "no-store" } });
  }

  const taskId = text(body.task_id || body.taskId || sp.get("task_id") || sp.get("taskId"), 400);
  if (!taskId) return NextResponse.json({ ok: false, action, error: "нужен task_id для judge" }, { status: 400 });
  const token = taskId.startsWith("fv.") ? taskId.slice(3) : "";
  const status = token ? await falVideoStatus(token) : { status: "error" as const, error: "плохой task_id" };
  if (status.status !== "done") return NextResponse.json({ ok: false, action, status }, { status: status.status === "error" ? 502 : 202, headers: { "Cache-Control": "no-store" } });
  const archive = status.videoUrl ? await archiveExternalMediaToYandex({
    sourceUrl: status.videoUrl,
    kind: "video",
    article: twin.article,
    niche: twin.category,
    name: taskId,
    subdir: "fal-video",
  }) : null;
  const frames = status.videoUrl ? await extractFrames(status.videoUrl) : [];
  const artifact = await runArtifactCheck(frames);
  const verdict = assessProductBrollQuality({
    article: twin.article,
    product: twin.productName,
    category: twin.category,
    sourceKind: view ? "product_twin_view" : "product_twin_latest",
    viewId: view?.viewId || null,
    frameCount: frames.length,
    artifact,
    manualOverride: bool(body.allow_complex_category || body.allowComplexCategory || sp.get("allow_complex_category") || sp.get("allowComplexCategory")),
  });
  const feedback = await recordFeedback({
    article: twin.article,
    twinId: twin.twinId,
    assetId: view?.sourceAssetId || pickedAsset?.asset.assetId || null,
    viewId: view?.viewId || null,
    taskId,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    score: verdict.score,
    note: `auto judge: ${verdict.recommendation.join("; ")}`.slice(0, 240),
    source: "product_broll_quality_loop_auto_judge",
  });
  const saved = status.videoUrl ? await insertGeneratedVideo({
    article: twin.article,
    niche: twin.category,
    videoUrl: status.videoUrl,
    yandexArchive: archive,
    taskId,
    verdict,
    source: { twin_id: twin.twinId, view_id: view?.viewId || null, category: twin.category },
  }) : null;
  return NextResponse.json({ ok: true, action, status, archive, frames: frames.length, artifact, verdict, feedback, saved }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return handle(req, {});
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body as Record<string, unknown>);
}
