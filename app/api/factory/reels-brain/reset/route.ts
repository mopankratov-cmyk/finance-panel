import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONFIRM = "RESET_REELS_BRAIN";
const REELS_BRAIN_PLAYBOOK_KEYS = [
  "reels_brain_patterns",
  "reels_brain_sources",
  "reels_brain_policy",
  "reels_brain_queries",
  "reels_brain_incidents",
  "reels_brain_top_hooks",
];

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanPlaybook(value: unknown): { playbook: Record<string, unknown>; changed: boolean } {
  const playbook = { ...rec(value) };
  let changed = false;
  for (const key of REELS_BRAIN_PLAYBOOK_KEYS) {
    if (key in playbook) {
      delete playbook[key];
      changed = true;
    }
  }
  return { playbook, changed };
}

async function snapshot(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const [{ count: videos }, { data: playbooks }] = await Promise.all([
    db.from("viral_videos").select("id", { count: "exact", head: true }),
    db.from("niche_playbooks").select("niche,playbook").limit(5000),
  ]);
  const rows = (playbooks as { niche?: string; playbook?: unknown }[] | null) || [];
  const playbooksWithBrain = rows.filter((row) => cleanPlaybook(row.playbook).changed);
  return {
    viral_videos: videos || 0,
    niche_playbooks_scanned: rows.length,
    niche_playbooks_with_reels_brain_memory: playbooksWithBrain.length,
    affected_playbook_niches: playbooksWithBrain.map((row) => String(row.niche || "")).filter(Boolean).slice(0, 100),
  };
}

async function reset(req: NextRequest, execute: boolean) {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const before = await snapshot(db);
  if (!execute) {
    return NextResponse.json({
      ok: true,
      execute: false,
      required_confirm: CONFIRM,
      scope: "Reels Brain only: viral_videos + reels_brain_* fields in niche_playbooks",
      before,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.confirm || "") !== CONFIRM) {
    return NextResponse.json({
      ok: false,
      error: `confirm must be ${CONFIRM}`,
      before,
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const { error: videosError } = await db
    .from("viral_videos")
    .delete()
    .neq("url", "__never__");
  if (videosError) return NextResponse.json({ ok: false, step: "viral_videos", error: videosError.message }, { status: 500 });

  const { data: playbooks, error: playbooksError } = await db
    .from("niche_playbooks")
    .select("niche,playbook")
    .limit(5000);
  if (playbooksError) return NextResponse.json({ ok: false, step: "niche_playbooks.select", error: playbooksError.message }, { status: 500 });

  let playbooksCleared = 0;
  for (const row of (playbooks as { niche?: string; playbook?: unknown }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    if (!niche) continue;
    const cleaned = cleanPlaybook(row.playbook);
    if (!cleaned.changed) continue;
    const { error } = await db
      .from("niche_playbooks")
      .update({ playbook: cleaned.playbook, updated_at: new Date().toISOString() })
      .eq("niche", niche);
    if (error) return NextResponse.json({ ok: false, step: "niche_playbooks.update", niche, error: error.message }, { status: 500 });
    playbooksCleared++;
  }

  const after = await snapshot(db);
  return NextResponse.json({
    ok: true,
    execute: true,
    scope: "Reels Brain only",
    before,
    reset: {
      viral_videos_deleted: before.viral_videos,
      niche_playbooks_cleared: playbooksCleared,
    },
    after,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return reset(req, false);
}

export async function POST(req: NextRequest) {
  return reset(req, true);
}
