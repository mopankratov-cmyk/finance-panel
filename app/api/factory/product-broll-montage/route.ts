import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getLatestProductTwinByArticle, getProductTwinViewAssets, type ProductTwinViewAsset } from "@/lib/factory/productTwinStore";
import { rehostImageForFal } from "@/lib/factory/rehostImage";
import { falTimeline, type FalTimelineClip } from "@/lib/factory/falVideo";
import { archiveExternalMediaToYandex } from "@/lib/factory/yandexArchive";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type MontageAction = "plan" | "render";

type MontageClip = {
  order: number;
  view_id: string;
  label: string;
  purpose: string;
  truth: string;
  duration_sec: number;
  url: string;
  preview_url: string;
};

const PREFERRED_VIEWS: Record<string, string[]> = {
  apparel: ["clean_front", "on_model_front", "closure_detail", "fabric_macro", "hood_detail", "back", "side", "lining_detail"],
  bag: ["clean_front", "front", "handle_detail", "hardware_detail", "inside_detail", "strap_detail", "side", "back"],
  cosmetics: ["front", "hero", "detail", "macro"],
  toy: ["front", "hero", "detail", "macro"],
  other: ["front", "clean_front", "detail", "macro"],
};

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: unknown): string {
  return text(value, 120).toLowerCase();
}

function actionFrom(req: NextRequest, body: Record<string, unknown>): MontageAction {
  const raw = text(body.action || req.nextUrl.searchParams.get("action") || "plan", 20);
  return raw === "render" ? "render" : "plan";
}

function previewUrl(view: ProductTwinViewAsset): string {
  return view.url.startsWith("yandex-disk:")
    ? `/api/factory/product-twin/asset-preview?url=${encodeURIComponent(view.url)}`
    : view.url;
}

function isRealPhotoView(view: ProductTwinViewAsset): boolean {
  const truth = normalized(view.truth);
  return truth === "derived_from_source" || truth === "source_crop" || truth === "real_photo";
}

function preferredViewOrder(category: string, views: ProductTwinViewAsset[]): ProductTwinViewAsset[] {
  const desired = PREFERRED_VIEWS[category] || PREFERRED_VIEWS.other;
  const scored = views
    .filter(isRealPhotoView)
    .map((view, index) => {
      const desiredIndex = desired.indexOf(view.viewId);
      const purpose = normalized(view.purpose);
      const purposeScore = purpose === "detail" ? 0 : purpose === "lifestyle" ? 1 : purpose === "angle" ? 2 : 3;
      return {
        view,
        desiredIndex: desiredIndex >= 0 ? desiredIndex : 999,
        purposeScore,
        index,
      };
    })
    .sort((a, b) => a.desiredIndex - b.desiredIndex || a.purposeScore - b.purposeScore || a.index - b.index);

  const unique = new Set<string>();
  const ordered: ProductTwinViewAsset[] = [];
  for (const item of scored) {
    if (unique.has(item.view.viewId)) continue;
    unique.add(item.view.viewId);
    ordered.push(item.view);
  }
  return ordered;
}

function buildMontageClips(category: string, views: ProductTwinViewAsset[]): MontageClip[] {
  const selected = preferredViewOrder(category, views).slice(0, 5);
  return selected.map((view, index) => ({
    order: index,
    view_id: view.viewId,
    label: view.label || view.viewId,
    purpose: view.purpose,
    truth: view.truth,
    duration_sec: index === 0 ? 3 : view.purpose === "detail" ? 2 : 3,
    url: view.url,
    preview_url: previewUrl(view),
  }));
}

async function insertRenderedMontage(input: {
  article: string;
  category: string;
  videoUrl: string;
  taskName: string;
  clips: MontageClip[];
  yandexArchive: unknown;
}) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const path = `product-broll-montage/${input.article}/${Date.now()}`;
  const { error } = await db.from("content_assets").insert({
    disk: "gen",
    path,
    name: `${input.article} real-photo montage`.slice(0, 120),
    kind: "video",
    niche: input.category || null,
    article: input.article,
    color: null,
    url: input.videoUrl,
    analyzed: true,
    analysis: {
      source: "product_broll_montage",
      task_name: input.taskName,
      montage_clips: input.clips,
      yandex_archive: input.yandexArchive,
    },
  });
  return error ? { ok: false, error: error.message } : { ok: true, path };
}

async function handle(req: NextRequest, body: Record<string, unknown>) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const article = text(body.article || req.nextUrl.searchParams.get("article"), 80);
  if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });

  const action = actionFrom(req, body);
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const twin = await getLatestProductTwinByArticle(db, article);
  if (!twin) return NextResponse.json({ ok: false, error: `twin для ${article} не найден` }, { status: 404 });

  const views = await getProductTwinViewAssets(db, { article, twinId: twin.twinId, limit: 80 });
  const clips = buildMontageClips(normalized(twin.category) || "other", views);
  if (!clips.length) {
    return NextResponse.json({
      ok: false,
      error: "нет derived_from_source views для real-photo montage",
      recommendation: "сначала собери clean/source-derived views из фотосессии без генеративных synthetic_candidate ракурсов",
    }, { status: 409 });
  }

  const plan = {
    lane: "real_photo_motion_montage",
    article: twin.article,
    product: twin.productName,
    category: twin.category,
    twin_id: twin.twinId,
    clips,
    recommendation: twin.category === "apparel" || twin.category === "bag"
      ? "use this lane for apparel and bags before any new paid generative experiment"
      : "use this lane when real-photo fidelity matters more than synthetic camera motion",
  };

  if (action === "plan") {
    return NextResponse.json({ ok: true, action, status: "planned", plan }, { headers: { "Cache-Control": "no-store" } });
  }

  const timeline: FalTimelineClip[] = [];
  for (const clip of clips) {
    timeline.push({
      url: await rehostImageForFal(clip.url),
      type: "image",
      durationSec: clip.duration_sec,
    });
  }

  const rendered = await falTimeline(timeline, { maxWaitMs: 55_000 });
  if (rendered.pending && rendered.responseUrl) {
    return NextResponse.json({
      ok: true,
      action,
      status: "processing",
      plan,
      pending_url: rendered.responseUrl,
      error: rendered.error || "timeline compose still processing",
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (rendered.error || !rendered.videoUrl) {
    return NextResponse.json({ ok: false, action, error: rendered.error || "compose без video_url", plan }, { status: 502 });
  }

  const taskName = `${article}-real-photo-montage`;
  const archive = await archiveExternalMediaToYandex({
    sourceUrl: rendered.videoUrl,
    kind: "video",
    article: twin.article,
    niche: twin.category,
    name: taskName,
    subdir: "fal-video",
  });
  const saved = await insertRenderedMontage({
    article: twin.article,
    category: twin.category,
    videoUrl: rendered.videoUrl,
    taskName,
    clips,
    yandexArchive: archive,
  });

  return NextResponse.json({
    ok: true,
    action,
    status: "rendered",
    plan,
    video_url: rendered.videoUrl,
    yandex_archive: archive,
    saved,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return handle(req, {});
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body as Record<string, unknown>);
}
