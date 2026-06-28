import type { SupabaseClient } from "@supabase/supabase-js";
import { assetMatchesArticle, classifyAssets, type DiskAsset } from "./assetBind";
import { isPrivateOrLocalUrl } from "./reelVariants";
import { fetchCabinetCards } from "@/lib/wb/cards";

export type SourceReadinessTier = "prepared" | "real" | "wb" | "none";

export interface SourceReadinessInfo {
  article: string;
  ready: boolean;
  tier: SourceReadinessTier;
  canonical_images: number;
  prepared_images: number;
  real_videos: number;
  real_images: number;
  wb_images: number;
}

function isRenderableSourceUrl(value: unknown): boolean {
  const url = String(value || "").trim();
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !isPrivateOrLocalUrl(url);
}

function summarizeArticle(article: string, assets: DiskAsset[]): SourceReadinessInfo {
  const pool = classifyAssets(assets);
  const canonical = (pool.canonicalImages || []).length;
  const prepared = (pool.preparedImages || []).length;
  const realVideos = pool.realVideos.length;
  const realImages = pool.realImages.length;
  const wbImages = pool.wbImages.length;
  const tier: SourceReadinessTier = (canonical || prepared) ? "prepared" : (realVideos || realImages) ? "real" : wbImages ? "wb" : "none";
  return {
    article,
    // WB-only is a weak source: useful as prep input, not render-ready for quality-first i2v.
    ready: tier === "prepared" || tier === "real",
    tier,
    canonical_images: canonical,
    prepared_images: prepared,
    real_videos: realVideos,
    real_images: realImages,
    wb_images: wbImages,
  };
}

export async function loadSourceReadiness(db: SupabaseClient, articles: string[]): Promise<Map<string, SourceReadinessInfo>> {
  const normalized = Array.from(new Set((articles || []).map((x) => String(x || "").trim()).filter(Boolean)));
  const out = new Map<string, SourceReadinessInfo>();
  for (const article of normalized) out.set(article, summarizeArticle(article, []));
  if (!normalized.length) return out;

  try {
    const { data } = await db
      .from("content_assets")
      .select("article,disk,kind,url,analysis")
      .in("article", normalized)
      .not("url", "is", null)
      .limit(Math.max(100, normalized.length * 20));
    const rows = (data as (DiskAsset & { article?: string | null })[] | null) || [];
    const byArticle = new Map<string, DiskAsset[]>();
    for (const row of rows) {
      const article = String(row.article || "").trim();
      if (!article) continue;
      const safe = assetMatchesArticle(row.url, article) && isRenderableSourceUrl(row.url);
      if (!safe) continue;
      const list = byArticle.get(article) || [];
      list.push({ disk: row.disk, kind: row.kind, url: row.url });
      byArticle.set(article, list);
    }
    for (const article of normalized) {
      out.set(article, summarizeArticle(article, byArticle.get(article) || []));
    }
  } catch {
    // fail-open to WB fallback below
  }

  const missing = normalized.filter((article) => !out.get(article)?.ready);
  if (!missing.length) return out;

  try {
    const cards = await fetchCabinetCards(null);
    const withCards = new Set(cards.map((card) => String(card.article || "").trim()).filter(Boolean));
    for (const article of missing) {
      if (withCards.has(article)) {
        out.set(article, {
          article,
          ready: false,
          tier: "wb",
          canonical_images: 0,
          prepared_images: 0,
          real_videos: 0,
          real_images: 0,
          wb_images: 1,
        });
      }
    }
  } catch {
    // WB fallback is best-effort; unresolved articles stay not ready
  }

  return out;
}

export async function resolveSourceReadyArticles(db: SupabaseClient, articles: string[]): Promise<Set<string>> {
  const info = await loadSourceReadiness(db, articles);
  const ready = new Set<string>();
  for (const [article, item] of info.entries()) {
    if (item.ready) ready.add(article);
  }
  return ready;
}
