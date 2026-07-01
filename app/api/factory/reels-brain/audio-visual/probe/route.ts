import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ProbeResult = {
  video_id?: number | string | null;
  asset_url?: string | null;
  ok?: boolean;
  error?: string | null;
  probe?: Record<string, unknown> | null;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mergeAnalyzedFull(existing: unknown, nextProbe: Record<string, unknown>) {
  const root = rec(existing);
  return {
    ...root,
    media_probe: {
      ...rec(root.media_probe),
      ...nextProbe,
      updated_at: new Date().toISOString(),
      source: "railway-ffprobe",
    },
    media_assets: root.media_assets || null,
    media_assets_updated_at: root.media_assets_updated_at || null,
  };
}

function withoutMediaProbe(existing: unknown) {
  const rest = { ...rec(existing) };
  delete rest.media_probe;
  return rest;
}

async function clearTransientProbeErrors(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  input: { niches?: unknown; error_prefix?: unknown; limit?: unknown },
) {
  const niches = Array.from(new Set(String(input.niches || "ru_toys,ru_clothing,ru_cosmetics")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 12);
  const errorPrefix = String(input.error_prefix || "spawn ffprobe ENOENT").trim();
  const limit = Math.min(1000, Math.max(1, Number(input.limit || 500)));
  const rows: { id: number; analyzed_full?: unknown }[] = [];

  for (const niche of niches) {
    const { data, error } = await db
      .from("viral_videos")
      .select("id,analyzed_full")
      .eq("niche", niche)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(`${niche}: ${error.message}`);
    rows.push(...((data || []) as { id: number; analyzed_full?: unknown }[]));
  }

  let cleared = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const probe = rec(rec(row.analyzed_full).media_probe);
    const probeError = String(probe.error || "");
    if (!probeError.startsWith(errorPrefix)) continue;
    const { error } = await db
      .from("viral_videos")
      .update({ analyzed_full: withoutMediaProbe(row.analyzed_full), updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) errors.push(`${row.id}: ${error.message}`);
    else cleared += 1;
  }

  return { ok: errors.length === 0, mode: "reels_brain_audio_visual_probe_cleanup", scanned: rows.length, cleared, errors: errors.slice(0, 20) };
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = (await req.json().catch(() => ({}))) as { results?: ProbeResult[]; action?: string; niches?: unknown; error_prefix?: unknown; limit?: unknown };
    if (body.action === "clear_transient_errors") {
      const cleanup = await clearTransientProbeErrors(db, body);
      return NextResponse.json(cleanup, { headers: { "Cache-Control": "no-store" } });
    }

    const results = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
    if (!results.length) return NextResponse.json({ error: "results пустой" }, { status: 400 });

    const ids = results
      .map((row) => Number(row.video_id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) return NextResponse.json({ error: "нет video_id" }, { status: 400 });

    const { data, error: selectError } = await db
      .from("viral_videos")
      .select("id,analyzed_full")
      .in("id", ids);
    if (selectError) return NextResponse.json({ error: "viral_videos select: " + selectError.message }, { status: 500 });

    const existingById = new Map(((data || []) as { id: number; analyzed_full?: unknown }[]).map((row) => [Number(row.id), row]));
    let updated = 0;
    const errors: string[] = [];

    for (const result of results) {
      const id = Number(result.video_id);
      const existing = existingById.get(id);
      if (!existing) {
        errors.push(`${id}: not found`);
        continue;
      }
      const payload = mergeAnalyzedFull(existing.analyzed_full, {
        ok: result.ok === true,
        error: result.error || null,
        asset_url: result.asset_url || null,
        ...(rec(result.probe)),
      });
      const { error: updateError } = await db
        .from("viral_videos")
        .update({ analyzed_full: payload, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) errors.push(`${id}: ${updateError.message}`);
      else updated += 1;
    }

    return NextResponse.json({
      ok: errors.length === 0,
      mode: "reels_brain_audio_visual_probe",
      received: results.length,
      updated,
      errors: errors.slice(0, 20),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "audio-visual/probe reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
