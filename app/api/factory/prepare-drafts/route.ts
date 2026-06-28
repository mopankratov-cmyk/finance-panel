import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { transferRecipeTemplate } from "@/lib/factory/recipeTransfer";
import { resolveSourceReadyArticles } from "@/lib/factory/sourceReadiness";

export const dynamic = "force-dynamic";
export const maxDuration = 45;
const DRAFT_LOOKUP_LIMIT = 50;

type Row = Record<string, unknown>;

function cleanText(value: unknown, max = 120): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueArticles(rows: Row[]): { article: string; product_name: string }[] {
  const seen = new Set<string>();
  const out: { article: string; product_name: string }[] = [];
  for (const row of rows) {
    const article = cleanText(row.article, 80);
    if (!article || seen.has(article)) continue;
    seen.add(article);
    out.push({ article, product_name: cleanText(row.product_name || row.name || "", 120) });
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const niche = cleanText(body.niche, 60) || null;
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));
    const dryRun = body.dry_run === true;

    let draftQ = db.from("node_recipes").select("id,article,niche").eq("status", "draft").order("id", { ascending: false }).limit(Math.max(count * 5, DRAFT_LOOKUP_LIMIT));
    if (niche) draftQ = draftQ.eq("niche", niche);
    const { data: draftRows, error: draftErr } = await draftQ;
    if (draftErr) return NextResponse.json({ ok: false, error: "draft lookup: " + draftErr.message }, { status: 500 });
    const existing = (draftRows as Row[] | null) || [];
    const existingArticles = existing.map((row) => cleanText(row.article, 80)).filter(Boolean);
    const sourceReadyExisting = await resolveSourceReadyArticles(db, existingArticles);
    const existingReadyDrafts = existing.filter((row) => sourceReadyExisting.has(cleanText(row.article, 80)));
    const existingDraftArticles = new Set(existingReadyDrafts.map((row) => cleanText(row.article, 80)).filter(Boolean));
    const needed = Math.max(0, count - existingReadyDrafts.length);

    if (!needed) {
      return NextResponse.json({
        ok: true,
        ready: true,
        dry_run: dryRun,
        requested_count: count,
        existing_drafts: existing.length,
        source_ready_existing_drafts: existingReadyDrafts.length,
        created: [],
        draft_ids: existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean),
        note: "draft queue already has enough source-ready recipes",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    let tplQ = db.from("node_templates").select("id,niche,format_type,nodes,confidence,created_at").order("confidence", { ascending: false, nullsFirst: false }).limit(Math.max(needed * 3, 10));
    if (niche) tplQ = tplQ.eq("niche", niche);
    const { data: templateRows, error: tplErr } = await tplQ;
    if (tplErr) return NextResponse.json({ ok: false, error: "template lookup: " + tplErr.message }, { status: 500 });
    const templates = ((templateRows as Row[] | null) || []).filter((row) => Array.isArray(row.nodes) && (row.nodes as unknown[]).length);
    if (!templates.length) {
      return NextResponse.json({
        ok: false,
        ready: false,
        dry_run: dryRun,
        requested_count: count,
        existing_drafts: existing.length,
        source_ready_existing_drafts: existingReadyDrafts.length,
        created: [],
        draft_ids: existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean),
        error: niche ? `нет node_templates для ниши ${niche}` : "нет node_templates для подготовки черновиков",
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    let articleQ = db.from("node_recipes").select("article,niche,created_at").not("article", "is", null).order("created_at", { ascending: false }).limit(80);
    if (niche) articleQ = articleQ.eq("niche", niche);
    const { data: articleRows, error: articleErr } = await articleQ;
    if (articleErr) return NextResponse.json({ ok: false, error: "article lookup: " + articleErr.message }, { status: 500 });
    const articles = uniqueArticles((articleRows as Row[] | null) || []);
    if (!articles.length) {
      return NextResponse.json({
        ok: false,
        ready: false,
        dry_run: dryRun,
        requested_count: count,
        existing_drafts: existing.length,
        source_ready_existing_drafts: existingReadyDrafts.length,
        created: [],
        draft_ids: existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean),
        error: niche ? `нет прошлых артикулов для ниши ${niche}` : "нет прошлых артикулов для подготовки черновиков",
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const sourceReadyArticles = await resolveSourceReadyArticles(db, articles.map((row) => row.article));
    const readyArticles = articles.filter((row) => sourceReadyArticles.has(row.article));
    const freshReadyArticles = readyArticles.filter((row) => !existingDraftArticles.has(row.article));
    const candidateArticles = freshReadyArticles.length ? freshReadyArticles : readyArticles;
    if (!readyArticles.length) {
      return NextResponse.json({
        ok: false,
        ready: false,
        dry_run: dryRun,
        requested_count: count,
        existing_drafts: existing.length,
        source_ready_existing_drafts: existingReadyDrafts.length,
        source_ready_articles: 0,
        created: [],
        draft_ids: existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean),
        error: niche ? `нет source-ready артикулов для ниши ${niche}` : "нет source-ready артикулов для подготовки черновиков",
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const plan = Array.from({ length: needed }, (_, idx) => {
      const tpl = templates[idx % templates.length];
      const product = candidateArticles[idx % candidateArticles.length];
      return {
        template_id: Number(tpl.id),
        article: product.article,
        product_name: product.product_name,
        niche: cleanText(tpl.niche, 60) || niche || undefined,
        format: cleanText(tpl.format_type, 80) || undefined,
      };
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ready: existingReadyDrafts.length + plan.length >= count,
        dry_run: true,
        requested_count: count,
        existing_drafts: existing.length,
        source_ready_existing_drafts: existingReadyDrafts.length,
        source_ready_articles: readyArticles.length,
        unique_source_ready_articles: candidateArticles.length,
        will_create: plan,
        created: [],
        draft_ids: existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const created: { recipe_id: number; template_id: number; article: string; niche: string | null }[] = [];
    const errors: string[] = [];
    for (const item of plan) {
      const result = await transferRecipeTemplate(db, { ...item, mode: "audience", built_by: "series_prepare", force_niche: true });
      if (result.ok && result.recipe_id) {
        created.push({ recipe_id: Number(result.recipe_id), template_id: item.template_id, article: item.article, niche: (result.niche as string | null) || null });
      } else {
        errors.push(String(result.error || "transfer failed").slice(0, 140));
      }
    }

    const draftIds = [...existingReadyDrafts.map((row) => Number(row.id)).filter(Boolean), ...created.map((row) => row.recipe_id)];
    return NextResponse.json({
      ok: created.length > 0 || draftIds.length >= count,
      ready: draftIds.length >= count,
      dry_run: false,
      requested_count: count,
      existing_drafts: existing.length,
      source_ready_existing_drafts: existingReadyDrafts.length,
      source_ready_articles: readyArticles.length,
      unique_source_ready_articles: candidateArticles.length,
      created,
      draft_ids: draftIds,
      errors,
      note: `prepared ${created.length} draft recipes for next batch`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, ready: false, error: "prepare-drafts crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
