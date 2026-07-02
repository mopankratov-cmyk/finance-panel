import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getLatestProductTwinByArticle, getProductTwinViewAssets, type ProductTwinViewAsset } from "@/lib/factory/productTwinStore";
import { rehostImageForFal } from "@/lib/factory/rehostImage";
import { falTimeline, type FalTimelineClip } from "@/lib/factory/falVideo";
import { archiveExternalMediaToYandex } from "@/lib/factory/yandexArchive";
import {
  summarizeProductBrollFeedback,
  type ProductBrollHumanVerdict,
  type ProductBrollRejectReason,
} from "@/lib/factory/productBrollLearning";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type MontageAction = "plan" | "render" | "status" | "feedback";

type MontageClip = {
  order: number;
  view_id: string;
  label: string;
  purpose: string;
  truth: string;
  duration_sec: number;
  slot: string;
  url: string;
  preview_url: string;
};

type MontageRow = {
  id: string;
  article?: string | null;
  niche?: string | null;
  url?: string | null;
  analysis?: Record<string, unknown> | null;
  created_at?: string | null;
};

type SlotRule = {
  slot: string;
  patterns: RegExp[];
  durationSec?: number;
};

const SLOT_RULES: Record<string, SlotRule[]> = {
  apparel: [
    { slot: "hero_front", patterns: [/clean[_ -]?front/i, /\bfront\b/i, /\bhero\b/i, /\bmain\b/i], durationSec: 3 },
    { slot: "closure_detail", patterns: [/closure/i, /zip/i, /button/i, /snap/i, /cuff/i, /collar/i, /hood/i], durationSec: 2 },
    { slot: "fabric_macro", patterns: [/fabric/i, /texture/i, /macro/i, /stitch/i, /seam/i, /material/i], durationSec: 2 },
    { slot: "silhouette_side", patterns: [/\bside\b/i, /angle/i, /profile/i], durationSec: 3 },
    { slot: "back_or_lining", patterns: [/\bback\b/i, /lining/i, /inside/i, /interior/i], durationSec: 3 },
  ],
  bag: [
    { slot: "hero_front", patterns: [/clean[_ -]?front/i, /\bfront\b/i, /\bhero\b/i, /\bmain\b/i], durationSec: 3 },
    { slot: "hardware_detail", patterns: [/hardware/i, /zip/i, /buckle/i, /metal/i, /logo/i], durationSec: 2 },
    { slot: "handle_or_strap", patterns: [/handle/i, /strap/i, /shoulder/i, /chain/i], durationSec: 2 },
    { slot: "inside_detail", patterns: [/inside/i, /interior/i, /lining/i, /pocket/i], durationSec: 2 },
    { slot: "side_or_back", patterns: [/\bside\b/i, /\bback\b/i, /profile/i, /angle/i], durationSec: 3 },
  ],
  cosmetics: [
    { slot: "hero_front", patterns: [/\bfront\b/i, /\bhero\b/i, /\bmain\b/i], durationSec: 3 },
    { slot: "detail", patterns: [/detail/i, /macro/i, /texture/i], durationSec: 2 },
  ],
  toy: [
    { slot: "hero_front", patterns: [/\bfront\b/i, /\bhero\b/i, /\bmain\b/i], durationSec: 3 },
    { slot: "detail", patterns: [/detail/i, /macro/i, /texture/i], durationSec: 2 },
  ],
  other: [
    { slot: "hero_front", patterns: [/\bfront\b/i, /clean/i, /\bhero\b/i], durationSec: 3 },
    { slot: "detail", patterns: [/detail/i, /macro/i, /angle/i], durationSec: 2 },
  ],
};

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: unknown): string {
  return text(value, 120).toLowerCase();
}

function reasons(value: unknown): ProductBrollRejectReason[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 40)).filter(Boolean).slice(0, 8) as ProductBrollRejectReason[];
}

function verdict(value: unknown): ProductBrollHumanVerdict | null {
  const raw = text(value, 20).toLowerCase();
  return raw === "winner" || raw === "usable" || raw === "weak" || raw === "reject" ? raw : null;
}

function actionFrom(req: NextRequest, body: Record<string, unknown>): MontageAction {
  const raw = text(body.action || req.nextUrl.searchParams.get("action") || "plan", 20);
  return raw === "render" || raw === "status" || raw === "feedback" ? raw : "plan";
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

function haystack(view: ProductTwinViewAsset): string {
  return [view.viewId, view.label, view.purpose, view.truth].map((part) => normalized(part)).join(" ");
}

function fallbackScore(view: ProductTwinViewAsset): number {
  const purpose = normalized(view.purpose);
  if (purpose === "detail") return 0;
  if (purpose === "angle") return 1;
  if (purpose === "lifestyle") return 2;
  return 3;
}

function buildMontageClips(category: string, views: ProductTwinViewAsset[]): MontageClip[] {
  const realViews = views.filter(isRealPhotoView);
  const rules = SLOT_RULES[category] || SLOT_RULES.other;
  const used = new Set<string>();
  const chosen: Array<{ view: ProductTwinViewAsset; slot: string; durationSec: number; score: number }> = [];

  for (const rule of rules) {
    const matched = realViews
      .map((view, index) => ({
        view,
        index,
        hit: rule.patterns.some((pattern) => pattern.test(haystack(view))),
        score: fallbackScore(view),
      }))
      .filter((item) => item.hit && !used.has(item.view.viewId))
      .sort((a, b) => a.score - b.score || a.index - b.index)[0];
    if (!matched) continue;
    used.add(matched.view.viewId);
    chosen.push({ view: matched.view, slot: rule.slot, durationSec: rule.durationSec || (matched.score === 0 ? 2 : 3), score: matched.score });
  }

  const fallback = realViews
    .map((view, index) => ({ view, index, score: fallbackScore(view) }))
    .filter((item) => !used.has(item.view.viewId))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, Math.max(0, 5 - chosen.length))
    .map((item) => ({
      view: item.view,
      slot: item.score === 0 ? "detail_fallback" : "support_fallback",
      durationSec: item.score === 0 ? 2 : 3,
      score: item.score,
    }));

  return [...chosen, ...fallback].slice(0, 5).map((item, index) => ({
    order: index,
    view_id: item.view.viewId,
    label: item.view.label || item.view.viewId,
    purpose: item.view.purpose,
    truth: item.view.truth,
    duration_sec: index === 0 ? 3 : item.durationSec,
    slot: item.slot,
    url: item.view.url,
    preview_url: previewUrl(item.view),
  }));
}

function falKey(): string | null {
  return process.env.FAL_KEY || process.env.FAL_BILLING_KEY || null;
}

function parseFalVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    video?: { url?: unknown };
    video_url?: unknown;
    url?: unknown;
    output?: { url?: unknown } | unknown;
    result?: unknown;
  };
  const direct = typeof record.video?.url === "string" ? record.video.url
    : typeof record.video_url === "string" ? record.video_url
    : typeof record.url === "string" ? record.url
    : typeof record.output === "string" ? record.output
    : typeof record.output === "object" && record.output && typeof (record.output as { url?: unknown }).url === "string" ? (record.output as { url: string }).url
    : null;
  if (direct) return direct;
  return record.result ? parseFalVideoUrl(record.result) : null;
}

async function resolveTimelineStatus(responseUrl: string): Promise<{
  status: "processing" | "done" | "error";
  videoUrl?: string;
  error?: string;
}> {
  const key = falKey();
  if (!key) return { status: "error", error: "FAL_KEY не настроен" };
  try {
    const statusRes = await fetch(`${responseUrl}/status`, {
      headers: { Authorization: `Key ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!statusRes.ok) return { status: "error", error: `timeline status ${statusRes.status}` };
    const statusJson = await statusRes.json().catch(() => ({})) as { status?: string };
    const queueStatus = String(statusJson.status || "").toUpperCase();
    if (queueStatus && queueStatus !== "COMPLETED") {
      if (queueStatus === "FAILED" || queueStatus === "ERROR" || queueStatus === "CANCELLED") {
        return { status: "error", error: `timeline ${queueStatus.toLowerCase()}` };
      }
      return { status: "processing" };
    }
    const resultRes = await fetch(responseUrl, {
      headers: { Authorization: `Key ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resultRes.ok) return { status: "error", error: `timeline result ${resultRes.status}` };
    const resultJson = await resultRes.json().catch(() => ({}));
    const videoUrl = parseFalVideoUrl(resultJson);
    if (!videoUrl) return { status: "error", error: "timeline без video_url" };
    return { status: "done", videoUrl };
  } catch (e) {
    return { status: "error", error: String((e as Error)?.message || e).slice(0, 180) };
  }
}

async function latestMontageRow(article: string): Promise<MontageRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from("content_assets")
    .select("id,article,niche,url,analysis,created_at")
    .eq("disk", "gen")
    .eq("article", article)
    .eq("kind", "video")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return null;
  const rows = (data || []) as MontageRow[];
  return rows.find((row) => normalized((row.analysis || {}).source) === "product_broll_montage") || null;
}

async function insertPendingMontage(input: {
  article: string;
  category: string;
  taskName: string;
  pendingUrl: string;
  clips: MontageClip[];
}) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const path = `product-broll-montage/${input.article}/${Date.now()}-pending`;
  const { data, error } = await db.from("content_assets").insert({
    disk: "gen",
    path,
    name: `${input.article} real-photo montage`.slice(0, 120),
    kind: "video",
    niche: input.category || null,
    article: input.article,
    color: null,
    url: null,
    analyzed: false,
    analysis: {
      source: "product_broll_montage",
      task_name: input.taskName,
      status: "processing",
      pending_url: input.pendingUrl,
      montage_clips: input.clips,
    },
  }).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, rowId: String(data?.id || "") };
}

async function updateMontageRow(rowId: string, patch: Record<string, unknown>, url?: string | null, analyzed?: boolean) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const { data } = await db.from("content_assets").select("analysis").eq("id", rowId).single();
  const currentAnalysis = ((data?.analysis || {}) as Record<string, unknown>);
  const analysis = { ...currentAnalysis, ...patch };
  const updatePayload: Record<string, unknown> = { analysis };
  if (typeof url !== "undefined") updatePayload.url = url;
  if (typeof analyzed !== "undefined") updatePayload.analyzed = analyzed;
  const { error } = await db.from("content_assets").update(updatePayload).eq("id", rowId);
  return error ? { ok: false, error: error.message } : { ok: true };
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
  const { data, error } = await db.from("content_assets").insert({
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
      status: "rendered",
      montage_clips: input.clips,
      yandex_archive: input.yandexArchive,
    },
  }).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, path, rowId: String(data?.id || "") };
}

async function saveMontageFeedback(input: {
  article: string;
  verdict: ProductBrollHumanVerdict;
  reasons: ProductBrollRejectReason[];
  note?: string | null;
  rowId?: string | null;
}) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const row = input.rowId ? { id: input.rowId } as MontageRow : await latestMontageRow(input.article);
  if (!row?.id) return { ok: false, error: "montage asset не найден" };
  const { data, error } = await db.from("content_assets").select("analysis,niche,article").eq("id", row.id).single();
  if (error) return { ok: false, error: error.message };
  const feedback = summarizeProductBrollFeedback({
    verdict: input.verdict,
    reasons: input.reasons,
    note: input.note || null,
  });
  const analysis = { ...((data?.analysis || {}) as Record<string, unknown>) };
  const history = Array.isArray(analysis.product_broll_feedback) ? analysis.product_broll_feedback as unknown[] : [];
  analysis.product_broll_feedback = [{
    ...feedback,
    article: input.article,
    at: new Date().toISOString(),
    source: "product_broll_montage_studio",
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
      niche: text(data?.niche, 80) || null,
      article: input.article,
      mode: "product_broll_montage_feedback",
    });
  } catch {
    // Best-effort learning signal.
  }
  return { ok: true, rowId: row.id, feedback };
}

async function handle(req: NextRequest, body: Record<string, unknown>) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const article = text(body.article || req.nextUrl.searchParams.get("article"), 80);
  if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });

  const action = actionFrom(req, body);

  if (action === "feedback") {
    const nextVerdict = verdict(body.verdict || req.nextUrl.searchParams.get("verdict"));
    if (!nextVerdict) {
      return NextResponse.json({ ok: false, error: "verdict должен быть winner, usable, weak или reject" }, { status: 400 });
    }
    const feedback = await saveMontageFeedback({
      article,
      verdict: nextVerdict,
      reasons: reasons(body.reasons),
      note: text(body.note || req.nextUrl.searchParams.get("note"), 240) || null,
      rowId: text(body.row_id || body.rowId || req.nextUrl.searchParams.get("row_id") || req.nextUrl.searchParams.get("rowId"), 80) || null,
    });
    return NextResponse.json({ ok: feedback.ok, action, feedback }, { status: feedback.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  }

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

  if (action === "status") {
    const pendingUrl = text(body.pending_url || body.pendingUrl || req.nextUrl.searchParams.get("pending_url") || req.nextUrl.searchParams.get("pendingUrl"), 1200)
      || text(((await latestMontageRow(article))?.analysis || {})?.pending_url, 1200);
    if (!pendingUrl) {
      return NextResponse.json({ ok: false, action, error: "нет pending_url для montage status" }, { status: 400 });
    }
    const row = await latestMontageRow(article);
    const taskName = text((row?.analysis || {}).task_name, 140) || `${article}-real-photo-montage`;
    const status = await resolveTimelineStatus(pendingUrl);
    if (status.status === "processing") {
      return NextResponse.json({ ok: true, action, status: "processing", pending_url: pendingUrl, plan, row_id: row?.id || null }, { headers: { "Cache-Control": "no-store" } });
    }
    if (status.status === "error" || !status.videoUrl) {
      if (row?.id) await updateMontageRow(row.id, { status: "error", error: status.error || "timeline failed" }, null, false);
      return NextResponse.json({ ok: false, action, status: "error", error: status.error || "timeline failed", pending_url: pendingUrl, plan, row_id: row?.id || null }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const archive = await archiveExternalMediaToYandex({
      sourceUrl: status.videoUrl,
      kind: "video",
      article: twin.article,
      niche: twin.category,
      name: taskName,
      subdir: "fal-video",
    });
    let saved: { ok: boolean; path?: string; rowId?: string; error?: string } | null = null;
    if (row?.id) {
      const updated = await updateMontageRow(row.id, {
        source: "product_broll_montage",
        task_name: taskName,
        status: "rendered",
        pending_url: pendingUrl,
        montage_clips: clips,
        yandex_archive: archive,
      }, status.videoUrl, true);
      saved = updated.ok ? { ok: true, rowId: row.id } : { ok: false, error: updated.error };
    } else {
      saved = await insertRenderedMontage({
        article: twin.article,
        category: twin.category,
        videoUrl: status.videoUrl,
        taskName,
        clips,
        yandexArchive: archive,
      });
    }
    return NextResponse.json({
      ok: true,
      action,
      status: "rendered",
      plan,
      video_url: status.videoUrl,
      pending_url: pendingUrl,
      yandex_archive: archive,
      saved,
      row_id: saved?.rowId || row?.id || null,
    }, { headers: { "Cache-Control": "no-store" } });
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
  const taskName = `${article}-real-photo-montage`;
  if (rendered.pending && rendered.responseUrl) {
    const saved = await insertPendingMontage({
      article: twin.article,
      category: twin.category,
      taskName,
      pendingUrl: rendered.responseUrl,
      clips,
    });
    return NextResponse.json({
      ok: true,
      action,
      status: "processing",
      plan,
      pending_url: rendered.responseUrl,
      row_id: saved.ok ? saved.rowId || null : null,
      saved,
      error: rendered.error || "timeline compose still processing",
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (rendered.error || !rendered.videoUrl) {
    return NextResponse.json({ ok: false, action, error: rendered.error || "compose без video_url", plan }, { status: 502 });
  }

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
    row_id: saved.rowId || null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return handle(req, {});
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body as Record<string, unknown>);
}
