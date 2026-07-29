import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

// Список различных категорий товара + карта article→category — общий источник
// для фильтра категорий на всех WB-аналитика таблицах (см. components/ui/CategoryFilter.tsx).
export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ categories: [], byArticle: {} });

  const { data, error } = await db.from("product_costs").select("article, category");
  if (error) return NextResponse.json({ categories: [], byArticle: {}, error: error.message });

  const byArticle: Record<string, string> = {};
  const set = new Set<string>();
  for (const r of data ?? []) {
    const cat = (r.category as string | null)?.trim();
    if (cat) { byArticle[r.article as string] = cat; set.add(cat); }
  }
  return NextResponse.json({ categories: [...set].sort((a, b) => a.localeCompare(b, "ru")), byArticle });
}
