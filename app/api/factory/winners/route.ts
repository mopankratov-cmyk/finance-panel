import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// P2.1 Winners loop: пометить content_asset победителем + записать learnings для петли.
// POST { asset_id?, url?, hook?, views?, followers?, note? }
//   asset_id — прямой id; url — поиск по url (из bank-карточки кокпита)
// GET  ?niche=blasters&limit=5  → примеры-победители для инъекции в идеацию
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const assetId = Number(body.asset_id) || 0;
  const url: string = (body.url || "").toString().trim();
  if (!assetId && !url) return NextResponse.json({ error: "нужен asset_id или url" }, { status: 400 });

  // читаем текущую запись: по id или по url (url — из bank-карточки кокпита, сохранён в content_assets disk='gen')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const { error } = await db.from("content_assets").update({
    is_winner: true,
    winner_at: new Date().toISOString(),
    winner_learnings: learnings,
  }).eq("id", assetId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, learnings });
}

export async function GET(req: NextRequest) {
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
}
