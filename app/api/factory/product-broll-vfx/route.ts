import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getBestProductTwinAsset } from "@/lib/factory/productTwinStore";
import { rehostImageForFal } from "@/lib/factory/rehostImage";
import { falVideoSubmitDetailed, falKlingEffectSubmit, FAL_VIDEO_MODELS, type FalVideoModel } from "@/lib/factory/falVideo";
import {
  VFX_ARTICLES, TRACK_A_MATRIX, TRACK_B_PROMPTS,
  buildTrackBPrompt, planWave1,
  type VfxCategory, type VfxArticle,
} from "@/lib/factory/brollVfx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// VFX b-roll раннер (docs/factory-broll-vfx-creatives-tz.md). Треки A (Kling effects) и B (i2v промпты).
// POST { article, category?, track?="B_prompts", submit?=false, count?, duration?="5" } — один артикул;
// POST { wave1:true, submit?=false } — план/прогон всей волны 1 (представители категорий).
// submit=false (по умолчанию) — план без списания FAL. submit=true сабмитит.

const CATEGORIES: VfxCategory[] = ["bag", "cosmetics", "toy", "apparel"];

function cleanModel(v: unknown): FalVideoModel {
  const raw = String(v || "").trim().slice(0, 40);
  return raw in FAL_VIDEO_MODELS ? raw as FalVideoModel : "kling";
}

function articleCategory(article: string): VfxCategory | null {
  for (const c of CATEGORIES) if (VFX_ARTICLES[c].some((a) => a.article.toUpperCase() === article.toUpperCase())) return c;
  return null;
}

function descriptorFor(article: string, category: VfxCategory): VfxArticle | null {
  return VFX_ARTICLES[category].find((a) => a.article.toUpperCase() === article.toUpperCase()) || null;
}

interface VfxJobPlan {
  clip_id: string;
  track: "A" | "B";
  category: VfxCategory;
  article: string;
  effect_scene?: string;
  prompt?: string;
  negative_prompt?: string;
  size_or_deform_distort: boolean;
  duration: "5" | "10";
}

// Собрать список задач для одного артикула (дедупная сборка A/B по треку).
function buildJobsForArticle(article: string, category: VfxCategory, track: "A" | "B" | "both", product: string, count: number, duration: "5" | "10"): VfxJobPlan[] {
  const jobs: VfxJobPlan[] = [];
  if (track === "A" || track === "both") {
    for (const row of TRACK_A_MATRIX.filter((r) => r.categories.includes(category)).slice(0, count)) {
      jobs.push({ clip_id: `vfx_a_${article}_${row.effect}`, track: "A", category, article, effect_scene: row.effect, size_or_deform_distort: !!row.deform, duration });
    }
  }
  if (track === "B" || track === "both") {
    for (const p of TRACK_B_PROMPTS[category].slice(0, count)) {
      const built = buildTrackBPrompt(category, p.id, product);
      jobs.push({ clip_id: `vfx_b_${article}_${p.id}`, track: "B", category, article, prompt: built.prompt, negative_prompt: built.negative_prompt, size_or_deform_distort: built.size_distort, duration });
    }
  }
  return jobs;
}

async function resolveSourceImage(db: ReturnType<typeof getSupabaseAdmin>, article: string): Promise<{ image: string } | { error: string }> {
  if (!db) return { error: "Supabase не настроен" };
  const picked = await getBestProductTwinAsset(db, { article, useCase: "broll" });
  if (!picked) return { error: `нет годного твина для ${article}` };
  const image = await rehostImageForFal(picked.asset.url);
  if (!image) return { error: `не удалось рехостить source для ${article}` };
  return { image };
}

async function submitJob(image: string, job: VfxJobPlan) {
  const res = job.track === "A"
    ? await falKlingEffectSubmit(image, job.effect_scene!, job.duration)
    : await falVideoSubmitDetailed("kling", image, job.prompt!, { duration: job.duration, negative: job.negative_prompt });
  return {
    clip_id: job.clip_id,
    track: job.track,
    article: job.article,
    effect_scene: job.effect_scene || null,
    task_id: res.token ? `fv.${res.token}` : null,
    ok: Boolean(res.token),
    error: res.token ? null : res.reason || "fal submit failed",
  };
}

async function handle(body: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const submit = body.submit === true;
  const duration = (String(body.duration || "5") === "10" ? "10" : "5") as "5" | "10";

  // Волна 1: план по представителям категорий (§6). Только план, если submit=false.
  if (body.wave1 === true) {
    const plan = planWave1();
    if (!submit) return NextResponse.json({ ok: true, mode: "dry_run", scope: "wave1", jobs: plan.jobs.length, warnings: plan.warnings, plan: plan.jobs }, { headers: { "Cache-Control": "no-store" } });
    // submit: для каждого представителя резолвим source один раз, сабмитим его задачи.
    if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });
    const rep: Record<VfxCategory, VfxArticle> = { bag: VFX_ARTICLES.bag[0], cosmetics: VFX_ARTICLES.cosmetics[0], toy: VFX_ARTICLES.toy[0], apparel: VFX_ARTICLES.apparel[0] };
    const out: unknown[] = [];
    for (const cat of CATEGORIES) {
      const art = rep[cat];
      const src = await resolveSourceImage(db, art.article);
      if ("error" in src) { out.push({ article: art.article, ok: false, error: src.error }); continue; }
      const jobs = buildJobsForArticle(art.article, cat, "both", art.product, 30, duration);
      for (const job of jobs) out.push(await submitJob(src.image, job));
    }
    return NextResponse.json({ ok: true, mode: "submitted", scope: "wave1", submitted: (out as { ok?: boolean }[]).filter((x) => x.ok).length, jobs: out, status_route: "/api/factory/video-fal-status/{task_id}?article={article}&niche=vfx", judge_route: "/api/factory/product-broll-loop?action=judge&article={article}&task_id={task_id}" }, { headers: { "Cache-Control": "no-store" } });
  }

  // Один артикул.
  const article = String(body.article || "").trim();
  if (!article) return NextResponse.json({ ok: false, error: "нужен article или wave1:true" }, { status: 400 });
  const category = (String(body.category || "").trim() as VfxCategory) || articleCategory(article);
  if (!category || !CATEGORIES.includes(category)) return NextResponse.json({ ok: false, error: `не удалось определить категорию для ${article}` }, { status: 400 });
  const desc = descriptorFor(article, category);
  if (desc?.blocked) return NextResponse.json({ ok: false, error: `${article} blocked: ${desc.note || "нет источника"}` }, { status: 409 });
  const product = String(body.product || desc?.product || `the ${article}`).trim();
  const track = (["A", "B", "both"].includes(String(body.track)) ? body.track : (String(body.track) === "A_effects" ? "A" : "B")) as "A" | "B" | "both";
  const count = Math.max(1, Math.min(30, Number(body.count) || 30));
  const jobs = buildJobsForArticle(article, category, track, product, count, duration);

  if (!submit) return NextResponse.json({ ok: true, mode: "dry_run", article, category, product, jobs: jobs.length, plan: jobs }, { headers: { "Cache-Control": "no-store" } });
  if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });
  const src = await resolveSourceImage(db, article);
  if ("error" in src) return NextResponse.json({ ok: false, error: src.error }, { status: 400 });
  const results = [];
  for (const job of jobs) results.push(await submitJob(src.image, job));
  return NextResponse.json({
    ok: true, mode: "submitted", article, category,
    submitted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, jobs: results,
    status_route: "/api/factory/video-fal-status/{task_id}?article=" + encodeURIComponent(article) + "&niche=vfx",
    judge_route: "/api/factory/product-broll-loop?action=judge&article=" + encodeURIComponent(article) + "&task_id={task_id}",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    return await handle(body as Record<string, unknown>);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "product-broll-vfx crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}

// Operator GET: dry-run плана из браузера. Платный submit — только POST.
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const sp = req.nextUrl.searchParams;
    const body: Record<string, unknown> = {
      article: sp.get("article") || "",
      category: sp.get("category") || "",
      track: sp.get("track") || "B",
      duration: sp.get("duration") || "5",
      count: sp.get("count") || "",
      wave1: sp.get("wave1") === "1",
      submit: false, // GET никогда не сабмитит
    };
    return await handle(body);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "product-broll-vfx GET crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
