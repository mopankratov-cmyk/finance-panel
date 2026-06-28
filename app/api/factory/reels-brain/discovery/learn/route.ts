import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rememberDiscoverySourceRun, type ReelsDiscoverySourceType } from "@/lib/factory/reelsBrainDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SOURCE_TYPES = new Set(["query", "hashtag", "account", "sound", "manual_url"]);

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const niche = String(body.niche || "default").trim() || "default";
    const type = String(body.type || body.source_type || "query").trim();
    if (!SOURCE_TYPES.has(type)) return NextResponse.json({ error: "unknown discovery source type" }, { status: 400 });
    const value = String(body.value || body.query || body.source_value || "").trim();
    if (!value) return NextResponse.json({ error: "нужен value/query источника" }, { status: 400 });

    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) return NextResponse.json({ error: "niche_playbooks: " + error.message }, { status: 500 });

    const current = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || { niche }) as Record<string, unknown>;
    const playbook = rememberDiscoverySourceRun(current, {
      niche,
      platform: body.platform || body.target_platform || "tiktok",
      type: type as ReelsDiscoverySourceType,
      value,
      found: Number(body.found || 0),
      relevant: Number(body.relevant || 0),
      breakout: Number(body.breakout || 0),
      inserted: Number(body.inserted || 0),
      cost_units: Number(body.cost_units || 1),
      reason: body.reason ? String(body.reason) : undefined,
    });

    const { error: upErr } = await db.from("niche_playbooks").upsert({
      niche,
      playbook: { ...playbook, niche },
      updated_at: new Date().toISOString(),
    }, { onConflict: "niche" });
    if (upErr) return NextResponse.json({ error: "niche_playbooks upsert: " + upErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      niche,
      platform: body.platform || body.target_platform || "tiktok",
      type,
      value,
      discovery: (playbook.reels_brain_discovery as Record<string, unknown> | undefined) || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "discovery/learn reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
