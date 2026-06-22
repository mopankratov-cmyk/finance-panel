import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { prepareProductImage } from "@/lib/factory/sourcePrep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ПРЕДПРОИЗВОДСТВО товара (upstream, до рецептов — симметрично анализу ниш): WB-инфографика → чистый+стейдж
// рендеры (Nano Banana via fal) → disk='prepared'. assetBind затем отдаёт их нодам вместо сырого WB.
//   POST { article, product?, scene?, niche?, count? } → { ok, prepared:[{staged,clean}], fails }
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (!process.env.FAL_KEY) return NextResponse.json({ error: "FAL_KEY не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const article = String(body.article || "").trim();
  if (!article) return NextResponse.json({ error: "нужен article" }, { status: 400 });
  const count = Math.min(4, Math.max(1, Number(body.count) || 2));
  const product = String(body.product || "").trim() || undefined;
  const scene = String(body.scene || "").trim() || undefined;

  // WB-фото товара из каталога
  const { data: wb } = await db.from("content_assets").select("url,niche").eq("article", article).eq("disk", "wb").eq("kind", "image").not("url", "is", null).limit(20);
  const rows = (wb as { url: string; niche?: string }[] | null) || [];
  if (!rows.length) return NextResponse.json({ error: `нет WB-фото для ${article}` }, { status: 400 });
  const niche = String(body.niche || rows[0]?.niche || "").trim() || undefined;

  // дедуп: уже подготовленные source_url не гоним повторно
  const { data: prep } = await db.from("content_assets").select("analysis").eq("article", article).eq("disk", "prepared");
  const done = new Set(((prep as { analysis?: { source_url?: string } }[] | null) || []).map((r) => r.analysis?.source_url).filter(Boolean));
  const todo = rows.map((r) => r.url).filter((u) => !done.has(u)).slice(0, count);
  if (!todo.length) return NextResponse.json({ ok: true, article, prepared: [], note: "всё уже подготовлено" });

  // параллельно в бюджете maxDuration: clean→stage каждый кадр
  const results = await Promise.all(todo.map((u) => prepareProductImage(u, { article, niche, product, scene })));
  const prepared = results.filter((r) => r.ok).map((r) => ({ staged: r.stagedUrl, clean: r.cleanUrl }));
  const fails = results.filter((r) => !r.ok).map((r) => r.error);
  return NextResponse.json({ ok: true, article, niche, requested: todo.length, prepared, fails });
}
