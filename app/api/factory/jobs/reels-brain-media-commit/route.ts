import { NextRequest, NextResponse } from "next/server";
import { normalizeReelsVideo } from "@/lib/factory/reelsBrain";
import { buildReelsSeedMetadata, mergeAnalyzedFullWithReelsSeed } from "@/lib/factory/reelsBrainCorpusUpsert";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CorpusRow = {
  id: number;
  url?: string | null;
  platform?: string | null;
  analyzed_full?: unknown;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 1200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const body = rec(await req.json().catch(() => null));
    const rowId = num(body.id);
    const targetUrl = text(body.url, 1500);
    const mediaUrl = text(body.media_url, 1500);
    if (!rowId || !targetUrl || !mediaUrl) {
      return NextResponse.json({ error: "id, url и media_url обязательны" }, { status: 400 });
    }

    const { data, error } = await db
      .from("viral_videos")
      .select("id,url,platform,analyzed_full")
      .eq("id", rowId)
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const row = ((data || []) as CorpusRow[])[0];
    if (!row?.id) return NextResponse.json({ error: "row not found" }, { status: 404 });

    const normalized = normalizeReelsVideo({
      url: targetUrl,
      video_url: mediaUrl,
      platform: text(body.platform, 60) || text(row.platform, 60) || undefined,
      author: text(body.author, 240) || undefined,
      duration_sec: num(body.duration_sec) ?? undefined,
      title: text(body.title, 500) || undefined,
    });
    if (!normalized) {
      return NextResponse.json({ error: "normalize failed" }, { status: 400 });
    }

    const seed = buildReelsSeedMetadata({
      video: normalized,
      sourceProvider: "railway_local_resolver",
      sourceQuery: targetUrl,
      sourceType: "provider",
    });
    const merged = mergeAnalyzedFullWithReelsSeed(row.analyzed_full, seed);
    const reelsSeed = rec(merged.reels_seed);
    const mediaLocators = Array.isArray(reelsSeed.media_locator_candidates)
      ? reelsSeed.media_locator_candidates.filter((item) => typeof item === "string" && item.trim())
      : [];

    const { error: updateError } = await db
      .from("viral_videos")
      .update({
        analyzed_full: merged,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      id: row.id,
      url: targetUrl,
      media_url: mediaUrl,
      media_locator_count: mediaLocators.length,
      source_provider: "railway_local_resolver",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: "reels-brain-media-commit crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
