import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { OPIU_ENTITY } from "@/lib/opiu/constants";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET — список себестоимостей. POST — upsert по артикулу.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ rows: [] });
  const q = (new URL(request.url).searchParams.get("q") || "").toLowerCase().trim();
  const { data, error } = await db.from("product_costs").select("article, name, cost_rub, brand, category").order("article");
  if (error) return NextResponse.json({ rows: [], error: error.message });
  let rows = (data ?? []).map((r) => ({ article: r.article as string, name: (r.name as string) ?? "", cost_rub: Number(r.cost_rub ?? 0), brand: (r.brand as string) ?? "", category: (r.category as string) ?? "" }));
  if (q) rows = rows.filter((r) => r.article.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  const filled = rows.filter((r) => r.cost_rub > 0).length;
  return NextResponse.json({ rows, count: rows.length, filled });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { article?: string; cost_rub?: number; name?: string; category?: string };
  const article = (b.article || "").trim();
  if (!article) return NextResponse.json({ error: "Укажите артикул" }, { status: 400 });
  const cost = Number(b.cost_rub) || 0;

  const { data: existing } = await db.from("product_costs").select("article").eq("article", article).maybeSingle();
  let error;
  if (existing) {
    const patch: Record<string, unknown> = { cost_rub: cost };
    if (b.name) patch.name = b.name.trim();
    if (b.category !== undefined) patch.category = b.category.trim() || null;
    ({ error } = await db.from("product_costs").update(patch).eq("article", article));
  } else {
    ({ error } = await db.from("product_costs").insert({ article, cost_rub: cost, name: (b.name || "").trim() || article, category: (b.category || "").trim() || null, entity: OPIU_ENTITY }));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
