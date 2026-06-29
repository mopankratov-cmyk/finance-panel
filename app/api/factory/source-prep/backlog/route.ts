import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { loadSourceReadiness } from "@/lib/factory/sourceReadiness";
import { prepareProductImage } from "@/lib/factory/sourcePrep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type WbAsset = { article?: string | null; url?: string | null; niche?: string | null; name?: string | null };

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function text(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function run(req: NextRequest, body: Record<string, unknown>) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  if (!process.env.FAL_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });

  const dryRun = body.dry_run === true || new URL(req.url).searchParams.get("dry_run") === "1";
  const limit = clampInt(body.limit ?? new URL(req.url).searchParams.get("limit"), 1, 1, 3);
  const imagesPerArticle = clampInt(body.images_per_article ?? new URL(req.url).searchParams.get("images_per_article"), 1, 1, 2);
  const requestedNiche = text(body.niche ?? new URL(req.url).searchParams.get("niche"), 80) || null;

  let q = db
    .from("content_assets")
    .select("article,url,niche,name")
    .eq("disk", "wb")
    .eq("kind", "image")
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (requestedNiche) q = q.eq("niche", requestedNiche);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = ((data || []) as WbAsset[]).filter((row) => text(row.article, 80) && /^https?:\/\//i.test(text(row.url, 1000)));
  const byArticle = new Map<string, WbAsset[]>();
  for (const row of rows) {
    const article = text(row.article, 80);
    const list = byArticle.get(article) || [];
    list.push(row);
    byArticle.set(article, list);
  }

  const readiness = await loadSourceReadiness(db, [...byArticle.keys()]);
  const candidates = [...byArticle.entries()]
    .map(([article, assets]) => ({ article, assets, readiness: readiness.get(article) || null }))
    .filter((item) => item.readiness?.tier === "wb")
    .slice(0, limit);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      requested: { limit, images_per_article: imagesPerArticle, niche: requestedNiche },
      candidates: candidates.map((item) => ({
        article: item.article,
        niche: item.assets[0]?.niche || null,
        wb_images: item.readiness?.wb_images || item.assets.length,
        prepared_images: item.readiness?.prepared_images || 0,
        real_images: item.readiness?.real_images || 0,
        real_videos: item.readiness?.real_videos || 0,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const items: Array<{
    article: string;
    niche: string | null;
    status: "prepared" | "failed";
    prepared: Array<{ staged?: string; clean?: string }>;
    errors: string[];
  }> = [];

  for (const item of candidates) {
    const niche = text(item.assets[0]?.niche, 80) || null;
    const product = text(item.assets[0]?.name || item.article, 120);
    const urls = item.assets.map((asset) => text(asset.url, 1000)).filter(Boolean).slice(0, imagesPerArticle);
    const results = await Promise.all(urls.map((url) => prepareProductImage(url, { article: item.article, niche: niche || undefined, product })));
    const prepared = results.filter((r) => r.ok).map((r) => ({ staged: r.stagedUrl, clean: r.cleanUrl }));
    const errors = results.filter((r) => !r.ok).map((r) => text(r.error, 220));
    items.push({
      article: item.article,
      niche,
      status: prepared.length ? "prepared" : "failed",
      prepared,
      errors,
    });
  }

  return NextResponse.json({
    ok: items.every((item) => item.status === "prepared"),
    dry_run: false,
    requested: { limit, images_per_article: imagesPerArticle, niche: requestedNiche },
    candidates: candidates.length,
    prepared_articles: items.filter((item) => item.status === "prepared").length,
    failed_articles: items.filter((item) => item.status === "failed").length,
    items,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  return run(req, {
    dry_run: sp.get("apply") !== "1",
    limit: sp.get("limit"),
    images_per_article: sp.get("images_per_article"),
    niche: sp.get("niche"),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return run(req, body);
}
