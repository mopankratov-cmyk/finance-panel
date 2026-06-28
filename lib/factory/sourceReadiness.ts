import type { SupabaseClient } from "@supabase/supabase-js";
import { assetMatchesArticle, classifyAssets, type DiskAsset } from "./assetBind";
import { isPrivateOrLocalUrl } from "./reelVariants";
import { fetchCabinetCards } from "@/lib/wb/cards";

function isRenderableSourceUrl(value: unknown): boolean {
  const url = String(value || "").trim();
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !isPrivateOrLocalUrl(url);
}

export async function resolveSourceReadyArticles(db: SupabaseClient, articles: string[]): Promise<Set<string>> {
  const normalized = Array.from(new Set((articles || []).map((x) => String(x || "").trim()).filter(Boolean)));
  const ready = new Set<string>();
  if (!normalized.length) return ready;

  try {
    const { data } = await db
      .from("content_assets")
      .select("article,disk,kind,url")
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
      const pool = classifyAssets(byArticle.get(article) || []);
      if ((pool.preparedImages || []).length || pool.realVideos.length || pool.realImages.length || pool.wbImages.length) ready.add(article);
    }
  } catch {
    // fail-open to WB fallback below
  }

  const missing = normalized.filter((article) => !ready.has(article));
  if (!missing.length) return ready;

  try {
    const cards = await fetchCabinetCards(null);
    const withCards = new Set(cards.map((card) => String(card.article || "").trim()).filter(Boolean));
    for (const article of missing) {
      if (withCards.has(article)) ready.add(article);
    }
  } catch {
    // WB fallback is best-effort; unresolved articles stay not ready
  }

  return ready;
}
