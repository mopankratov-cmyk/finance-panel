import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V3 нод-студия: агрегатор данных для экранов 01 (карта осознания) / 02 (лента виральных) / 06 (библиотека).
//   GET            → { niches:[{niche,videos,hooks,playbook,templates,gens}], generations[], recipes[] }
//   GET ?niche=X   → { niche, feed:[виральные видео ниши], templates[], recipes[] }
// Всё best-effort: каждая выборка в своём try → пустой раздел вместо краха. Всегда JSON.

const NICHES = ["cosmetics", "clothing", "toys", "default"];
const NICHE_META: Record<string, { emoji: string; label: string }> = {
  cosmetics: { emoji: "💄", label: "Косметика" },
  clothing: { emoji: "🧥", label: "Одежда" },
  toys: { emoji: "🔫", label: "Игрушки" },
  default: { emoji: "📦", label: "Прочее" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(db: any, table: string, niche: string, extra?: (q: any) => any): Promise<number> {
  try {
    let q = db.from(table).select("id", { count: "exact", head: true }).eq("niche", niche);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  } catch { return 0; }
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const niche = (req.nextUrl.searchParams.get("niche") || "").trim();

    // ── режим одной ниши: лента виральных + шаблоны + рецепты ──
    if (niche) {
      let feed: unknown[] = [];
      let templates: unknown[] = [];
      let recipes: unknown[] = [];
      try {
        const { data } = await db.from("viral_videos").select("id,url,caption,views,likes,virality_score,hook_text,format_detected,sound_title,platform").eq("niche", niche).order("virality_score", { ascending: false, nullsFirst: false }).limit(24);
        feed = data || [];
      } catch { /* нет корпуса */ }
      try {
        const { data } = await db.from("node_templates").select("id,format_type,niche,confidence,nodes,source_video_url,created_at").eq("niche", niche).order("created_at", { ascending: false }).limit(20);
        templates = (data || []).map((t: Record<string, unknown>) => ({ ...t, nodes_count: Array.isArray(t.nodes) ? t.nodes.length : 0, nodes: undefined }));
      } catch { /* нет шаблонов */ }
      try {
        const { data } = await db.from("node_recipes").select("id,article,niche,mode,status,otk_score,output_url,format_detected,created_at").eq("niche", niche).order("created_at", { ascending: false }).limit(20);
        recipes = data || [];
      } catch { /* нет рецептов */ }
      return NextResponse.json({ ok: true, niche, feed, templates, recipes }, { headers: { "Cache-Control": "no-store" } });
    }

    // ── обзор всех ниш ──
    const niches = await Promise.all(NICHES.map(async (n) => {
      const [videos, hooks, templates, gens, pb] = await Promise.all([
        count(db, "viral_videos", n),
        count(db, "viral_hooks", n),
        count(db, "node_templates", n),
        count(db, "content_assets", n, (q) => q.eq("disk", "gen")),
        (async () => { try { const { data } = await db.from("niche_playbooks").select("niche").eq("niche", n).limit(1); return !!(data && data.length); } catch { return false; } })(),
      ]);
      return { niche: n, ...NICHE_META[n], videos, hooks, templates, gens, playbook: pb };
    }));

    let generations: unknown[] = [];
    try {
      const { data } = await db.from("content_assets").select("name,kind,url,niche,article,analysis,created_at").eq("disk", "gen").order("created_at", { ascending: false }).limit(40);
      generations = (data || []).filter((r: Record<string, unknown>) => String(r.url || "").startsWith("http"));
    } catch { /* нет генераций */ }

    let recipes: unknown[] = [];
    try {
      const { data } = await db.from("node_recipes").select("id,article,niche,mode,status,otk_score,output_url,format_detected,built_by,created_at").order("created_at", { ascending: false }).limit(30);
      recipes = data || [];
    } catch { /* нет рецептов */ }

    return NextResponse.json({ ok: true, niches, generations, recipes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "studio crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
