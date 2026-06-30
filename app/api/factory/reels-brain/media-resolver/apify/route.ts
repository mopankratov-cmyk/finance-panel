import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeViralVideoRows, type ReelsBrainInput } from "@/lib/factory/reelsBrain";
import { apifyTikTokItemToReelsBrainInput } from "@/lib/factory/reelsBrainSources";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ApifyRun = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  actId?: string;
};

const DEFAULT_ACTOR = "clockworks/tiktok-scraper";

function apifyActorPath(actor: string): string {
  return actor.trim().replace(/\//g, "~");
}

function hashtagSeeds(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-zа-я0-9#\s_-]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^#/, "").trim())
    .filter((token) => token.length >= 3 && !["reels", "reel", "review", "обзор"].includes(token));
  const compact = tokens.join("");
  return Array.from(new Set([compact, ...tokens].filter(Boolean))).slice(0, 5);
}

function tiktokActorInput(query: string, limit: number, downloadVideos: boolean) {
  return {
    searchQueries: [query],
    queries: [query],
    search: [query],
    keyword: query,
    keywords: [query],
    hashtags: hashtagSeeds(query),
    maxItems: limit,
    resultsPerPage: limit,
    resultsLimit: limit,
    maxResults: limit,
    maxProfilesPerQuery: 1,
    searchSection: "",
    excludePinnedPosts: false,
    scrapeRelatedVideos: false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers: false,
    shouldDownloadMusicCovers: false,
    shouldDownloadSlideshowImages: false,
    shouldDownloadSubtitles: false,
    shouldDownloadVideos: downloadVideos,
    downloadVideos,
    proxyCountryCode: "None",
    proxy: { useApifyProxy: true },
  };
}

function mediaAssets(value: unknown): unknown[] {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as { assets?: unknown[]; media_assets?: { assets?: unknown[] } } : {};
  if (Array.isArray(root.assets)) return root.assets;
  if (Array.isArray(root.media_assets?.assets)) return root.media_assets.assets;
  return [];
}

function mergeMediaEnvelope(existing: unknown, envelope: unknown) {
  const existingRoot = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
  return {
    ...existingRoot,
    media_assets: envelope,
    media_assets_updated_at: new Date().toISOString(),
  };
}

async function startRun(input: { actor: string; query: string; limit: number; downloadVideos: boolean }) {
  const token = process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("APIFY_TOKEN не настроен");
  const actorPath = apifyActorPath(input.actor);
  const url = `https://api.apify.com/v2/acts/${actorPath}/runs?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tiktokActorInput(input.query, input.limit, input.downloadVideos)),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: { data?: ApifyRun; error?: { message?: string } } = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(`apify start ${res.status}: ${text.slice(0, 300)}`);
  const run = json.data || {};
  if (!run.id) throw new Error("Apify run id не найден");
  return run;
}

async function getRun(runId: string): Promise<ApifyRun> {
  const token = process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("APIFY_TOKEN не настроен");
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let json: { data?: ApifyRun } = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(`apify run ${res.status}: ${text.slice(0, 300)}`);
  return json.data || {};
}

async function getDatasetItems(datasetId: string, limit: number): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("APIFY_TOKEN не настроен");
  const url = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set("token", token);
  url.searchParams.set("clean", "true");
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json: unknown = [];
  try { json = text ? JSON.parse(text) : []; } catch {}
  if (!res.ok) throw new Error(`apify dataset ${res.status}: ${text.slice(0, 300)}`);
  return Array.isArray(json) ? json.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)) : [];
}

async function persistInputs(input: { niche: string; query: string; actor: string; rows: ReelsBrainInput[] }) {
  const db = getSupabaseAdmin();
  if (!db) return { inserted: 0, media_updated: 0, warning: "Supabase не настроен" };
  const prepared = makeViralVideoRows(input.rows, {
    niche: input.niche,
    sourceProvider: `apify_async:${input.actor}`,
    sourceQuery: input.query,
    sourceType: "provider",
  });
  if (!prepared.rows.length) return { inserted: 0, media_updated: 0, rejected: prepared.rejected };

  const { count, error } = await db
    .from("viral_videos")
    .upsert(prepared.rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
  if (error) throw new Error(`viral_videos insert: ${error.message}`);

  const rowsWithAssets = prepared.rows.filter((row) => mediaAssets(row.analyzed_full).length > 0);
  let mediaUpdated = 0;
  if (rowsWithAssets.length) {
    const urls = rowsWithAssets.map((row) => row.url);
    const { data, error: selectError } = await db
      .from("viral_videos")
      .select("id,url,analyzed_full")
      .in("url", urls);
    if (selectError) throw new Error(`viral_videos select: ${selectError.message}`);
    const existingByUrl = new Map(((data || []) as { id: number; url: string; analyzed_full?: unknown }[]).map((row) => [row.url, row]));
    for (const row of rowsWithAssets) {
      const existing = existingByUrl.get(row.url);
      if (!existing?.id) continue;
      const merged = mergeMediaEnvelope(existing.analyzed_full, row.analyzed_full);
      const { error: updateError } = await db
        .from("viral_videos")
        .update({ analyzed_full: merged })
        .eq("id", existing.id);
      if (updateError) throw new Error(`viral_videos media update: ${updateError.message}`);
      mediaUpdated += 1;
    }
  }

  return {
    inserted: count ?? prepared.rows.length,
    media_updated: mediaUpdated,
    normalized: prepared.rows.length,
    rejected: prepared.rejected,
    assets_found: rowsWithAssets.length,
  };
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "start").trim().toLowerCase();
    const actor = String(body.actor || process.env.APIFY_TIKTOK_ACTOR || process.env.APIFY_ACTOR || DEFAULT_ACTOR).trim();
    const query = String(body.query || "детские игрушки обзор").trim().slice(0, 160);
    const niche = String(body.niche || "ru_toys").trim().slice(0, 80) || "ru_toys";
    const limit = Math.max(1, Math.min(20, Number(body.limit || 3)));
    const downloadVideos = body.download_videos !== false;

    if (action === "start") {
      const run = await startRun({ actor, query, limit, downloadVideos });
      return NextResponse.json({
        ok: true,
        action,
        actor,
        query,
        niche,
        limit,
        download_videos: downloadVideos,
        run_id: run.id,
        status: run.status || "RUNNING",
        dataset_id: run.defaultDatasetId || null,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "poll") {
      const runId = String(body.run_id || "").trim();
      if (!runId) return NextResponse.json({ error: "run_id обязателен для poll" }, { status: 400 });
      const run = await getRun(runId);
      const status = String(run.status || "UNKNOWN");
      const datasetId = String(body.dataset_id || run.defaultDatasetId || "").trim();
      if (status !== "SUCCEEDED") {
        return NextResponse.json({ ok: true, action, run_id: runId, status, dataset_id: datasetId || null, done: false }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!datasetId) return NextResponse.json({ ok: false, action, run_id: runId, status, error: "dataset_id не найден" }, { status: 500 });
      const items = await getDatasetItems(datasetId, limit);
      const inputs = items.map(apifyTikTokItemToReelsBrainInput).filter((row) => row.url);
      const persisted = await persistInputs({ niche, query, actor, rows: inputs });
      return NextResponse.json({
        ok: true,
        action,
        run_id: runId,
        status,
        done: true,
        dataset_id: datasetId,
        found: items.length,
        normalized: inputs.length,
        persisted,
        sample_keys: Object.keys(items[0] || {}).slice(0, 30),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "apify media resolver упал: " + String((e as Error)?.message || e).slice(0, 300),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
