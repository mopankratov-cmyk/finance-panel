import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { incidentHistory, incidentSummary, normalizeShortPlatform, preferredSourceProviders, sourceProviderHistory } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function daysSince(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niche: null, alerts: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    const niche = String(req.nextUrl.searchParams.get("niche") || "").trim();
    if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });

    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const playbook = ((data as { playbook?: unknown }[] | null)?.[0]?.playbook || null) as unknown;
    const alerts = incidentHistory(playbook).slice(0, 30);
    const providerSnapshots = (["tiktok", "instagram", "youtube"] as const).map((platform) => {
      const preferred = preferredSourceProviders(playbook)[normalizeShortPlatform(platform)];
      const history = sourceProviderHistory(playbook, platform).slice(0, 2);
      return {
        platform,
        preferred_provider: preferred?.provider || null,
        stale_days: daysSince(preferred?.updated_at),
        drift: history.length > 1 && history[0].provider !== history[1].provider,
      };
    });

    return NextResponse.json({
      ok: true,
      niche,
      alerts,
      summary: incidentSummary(playbook),
      provider_snapshots: providerSnapshots,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "alerts reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
