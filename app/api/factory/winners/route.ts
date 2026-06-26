import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// P2.1 Winners loop: пометить content_asset победителем + записать learnings для петли.
// POST { asset_id?, url?, hook?, views?, followers?, note?, platform?, watch_rate?, ctr_card?, saves?, posted_at? }
//   asset_id — прямой id; url — поиск по url (из bank-карточки кокпита)
// GET  ?niche=blasters&limit=5  → примеры-победители для инъекции в идеацию
export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const assetId = Number(body.asset_id) || 0;
  const url: string = (body.url || "").toString().trim();
  if (!assetId && !url) return NextResponse.json({ error: "нужен asset_id или url" }, { status: 400 });

  // читаем текущую запись: по id или по url (url — из bank-карточки кокпита, сохранён в content_assets disk='gen')

  let assetQ: any = db.from("content_assets").select("*");
  if (assetId) assetQ = assetQ.eq("id", assetId);
  else assetQ = assetQ.eq("url", url).eq("disk", "gen");
  const { data: asset } = await assetQ.maybeSingle();
  if (!asset) return NextResponse.json({ error: "контент не найден в БД (применить миграцию 20260622?)" }, { status: 404 });

  const analysis = (asset.analysis || {}) as Record<string, unknown>;
  const learnings: Record<string, unknown> = {
    hook: String(body.hook || analysis.hook || asset.name || "").slice(0, 120),
    format: String(body.format || analysis.route || "").slice(0, 40),
    route: String(analysis.route || "").slice(0, 40),
    engine: String(analysis.engine || "").slice(0, 20),
    otk_score: analysis.otk ?? null,
  };
  if (body.views) learnings.views = Number(body.views);
  if (body.followers) learnings.followers = Number(body.followers);
  if (body.note) learnings.note = String(body.note).slice(0, 200);
  if (body.platform || body.watch_rate != null || body.ctr_card != null || body.saves != null || body.posted_at) {
    learnings.market_signal = {
      platform: body.platform ? String(body.platform).slice(0, 20) : null,
      views: body.views ? Number(body.views) : null,
      watch_rate: body.watch_rate != null ? Number(body.watch_rate) : null,
      ctr_card: body.ctr_card != null ? Number(body.ctr_card) : null,
      saves: body.saves != null ? Number(body.saves) : null,
      posted_at: body.posted_at ? String(body.posted_at).slice(0, 40) : null,
    };
  }

  const { error } = await db.from("content_assets").update({
    is_winner: true,
    winner_at: new Date().toISOString(),
    winner_learnings: learnings,
  }).eq("id", asset.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Замыкаем петлю: победивший хук → viral_hooks с максимальным весом (viability_score=5)
  // Так hook-judge автоматически поднимает наши проверенные хуки в следующем цикле генерации
  if (learnings.hook) {
    const niche = nicheFromArticle(asset.article || "", asset.name || "");
    const note = `winner: ${learnings.format || "unknown"} | otk: ${learnings.otk_score ?? "?"} | ${learnings.note || ""}`.slice(0, 200);
    try {
      await db.from("viral_hooks").upsert(
        { niche, hook_text: String(learnings.hook), viability_score: 5, effectiveness_notes: note },
        { onConflict: "niche,hook_text", ignoreDuplicates: false }
      );
    } catch {
      try {
        const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }).eq("niche", niche).eq("hook_text", String(learnings.hook));
        if (!count) await db.from("viral_hooks").insert({ niche, hook_text: String(learnings.hook), viability_score: 5, effectiveness_notes: note });
        else await db.from("viral_hooks").update({ viability_score: 5, effectiveness_notes: note }).eq("niche", niche).eq("hook_text", String(learnings.hook));
      } catch { /* viral_hooks не применена */ }
    }
  }

  // V14 · снимок ПРОИЗВОДСТВЕННЫХ настроек победителя в пресет (если знаем рецепт-первоисточник)
  let preset_id: number | null = null;
  const recipeId = Number(body.recipe_id) || 0;
  if (recipeId) {
    try {
      const wniche = nicheFromArticle(asset.article || "", asset.name || "");
      preset_id = await snapshotWinnerPreset(db, recipeId, wniche, String(learnings.format || ""), String((learnings.note as string) || `otk ${learnings.otk_score ?? "?"} · ${learnings.views ?? "?"} просм`).slice(0, 180));
    } catch { /* пресет best-effort */ }
  }

  return NextResponse.json({ ok: true, learnings, preset_id });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      learnings: null,
      preset_id: null,
      error: "winners POST crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}

// V14 · из run_plan победившего рецепта собираем переиспользуемый пресет в node_templates:
// движок (tool) + params (настройки движка/сабтайтров/музыки/визстиля) + длительности по РОЛЯМ.
// Снимаем volatile-ключи (preview_url/preview_hash) — иначе на НОВОМ товаре V10 переиспользует
// старый рендер победителя. prompt оставляем как черновик (transfer всё равно правится под товар).

async function snapshotWinnerPreset(db: any, recipeId: number, niche: string, format: string, winNote: string): Promise<number | null> {
  const { data } = await db.from("node_recipes").select("run_plan,format_detected,niche").eq("id", recipeId).maybeSingle();
  if (!data) return null;
  const plan = (data.run_plan || {}) as Record<string, unknown>;
  const rawNodes = (Array.isArray(plan.nodes) ? plan.nodes : []) as Record<string, unknown>[];
  if (!rawNodes.length) return null;
  const VOLATILE = new Set(["preview_url", "preview_hash"]);
  const nodes = rawNodes
    .filter((n) => String(n.status || "") !== "skip" && (n.tool || n.node_type))
    .map((n, i) => {
      const params = { ...((n.params as Record<string, unknown>) || {}) };
      for (const k of VOLATILE) delete params[k];
      const role = String((params.role as string) || (n.slot as string) || "").toLowerCase();
      return {
        ordinal: typeof n.ordinal === "number" ? n.ordinal : i + 1,
        node_type: n.node_type || null,
        tool: n.tool || null,
        role,
        prompt: String(n.prompt || "").slice(0, 1500),
        onscreen_text: String((n.onscreen_text as string) || (params.onscreen_text as string) || "").slice(0, 300) || null,
        emotion: (params.emotion as string) || null,
        visual_desc: String((params.visual_desc as string) || "").slice(0, 300) || null,
        params,
        duration_sec: typeof n.duration_sec === "number" ? n.duration_sec : null,
      };
    });
  if (!nodes.length) return null;
  const fmt = format || String(data.format_detected || "") || "winner";
  const nch = niche || String(data.niche || "") || "default";
  // дедуп: один пресет на рецепт-первоисточник (пересохранение победителя не плодит дубли)
  // supabase возвращает { error } (а не throws) → старый try/catch тут не ловил. Проверяем error явно и логируем.
  const { error: delErr } = await db.from("node_templates").delete().eq("source_recipe_id", recipeId);
  if (delErr) console.error("[winners] dedup-delete error (миграция source_recipe_id применена?):", delErr.message);
  const { data: ins, error: insErr } = await db.from("node_templates").insert({
    format_type: fmt, niche: nch, nodes, confidence: "high",
    from_winner: true, win_note: winNote, source_recipe_id: recipeId,
  }).select("id").maybeSingle();
  if (insErr) console.error("[winners] preset insert error:", insErr.message);
  return (ins?.id as number) ?? null;
}

export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { searchParams } = req.nextUrl;
  const article = searchParams.get("article") || "";
  const niche = searchParams.get("niche") || (article ? nicheFromArticle(article, "") : "");
  const limit = Math.min(10, Math.max(1, Number(searchParams.get("limit") || 5)));

  let q = db.from("content_assets")
    .select("id,name,niche,article,winner_learnings,winner_at")
    .eq("is_winner", true)
    .order("winner_at", { ascending: false })
    .limit(limit);
  if (niche) q = q.eq("niche", niche);

  try {
    const { data, error } = await q;
    if (error) return NextResponse.json({ winners: [], error: error.message });
    return NextResponse.json({ winners: data || [], niche });
  } catch (e) {
    return NextResponse.json({ winners: [], error: String(e).slice(0, 100) });
  }
  } catch (e) {
    return NextResponse.json({
      winners: [],
      niche: "",
      error: "winners GET crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
