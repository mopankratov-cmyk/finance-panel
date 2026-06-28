import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDiscoveryPlan } from "@/lib/factory/reelsBrainDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function loadPlaybook(niche: string): Promise<Record<string, unknown>> {
  const db = getSupabaseAdmin();
  if (!db) return { niche };
  const { data } = await db
    .from("niche_playbooks")
    .select("playbook")
    .eq("niche", niche)
    .order("updated_at", { ascending: false })
    .limit(1);
  return ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || { niche }) as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const niche = String(sp.get("niche") || "default").trim() || "default";
    const platform = sp.get("platform") || sp.get("target_platform") || "tiktok";
    const playbook = await loadPlaybook(niche);
    const plan = buildDiscoveryPlan(playbook, {
      niche,
      platform,
      max_items: Number(sp.get("max_items") || 6),
      source_limit: Number(sp.get("source_limit") || 25),
      provider_hint: sp.get("provider_hint") as never,
    });
    return NextResponse.json({ ok: true, plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "discovery/plan reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

