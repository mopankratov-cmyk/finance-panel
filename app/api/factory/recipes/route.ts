import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// §15 «Перенести себе»: каркас конкурента (node_templates или nodes) → черновой node_recipes + node_recipe_nodes.
// КОПИРУЕТСЯ КАРКАС (slot/node_type/tool/тайминг), content ОБНУЛЯЕТСЯ под твой товар (asset_url/prompt/params пустые);
// оригинал конкурента → agent_suggestion (референс).
//   GET  ?recipe_id=                                  → отдать рецепт (голова + ноды)
//   GET  ?template_id=&article=&product_name=&mode=   → ПЕРЕНОС (удобный тест из браузера)
//   POST { template_id?|nodes?, article, product_name?, niche?, mode?, format? } → перенос
// Всегда JSON (обработчик в try/catch).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roleToSlot(n: any): string {
  const r = String(n?.role || "").toLowerCase();
  const t = String(n?.node_type || "").toLowerCase();
  if (t === "captions") return "caption";
  if (t === "music" || t === "sound") return "music";
  if (t === "transition") return "transition";
  if (r === "hook") return "hook";
  if (r === "cta") return "payoff";
  return "scene";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transfer(db: any, p: { template_id?: string | number; nodes?: any[]; article: string; product_name?: string; niche?: string; mode?: string; format?: string }) {
  const article = (p.article || "").toString().trim();
  if (!article) return { error: "нужен article (товар, под который переносим)", status: 400 };
  const productName = (p.product_name || "").toString().trim();
  const mode = p.mode === "sell" ? "sell" : "audience";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tplNodes: any[] = Array.isArray(p.nodes) ? p.nodes : [];
  let format = (p.format || "").toString();
  let niche = (p.niche || "").toString().trim();
  let srcVideoId: number | null = null;

  if (!tplNodes.length && p.template_id) {
    const { data } = await db.from("node_templates").select("nodes,format_type,niche,source_viral_video_id").eq("id", p.template_id).limit(1);
    const tpl = (data || [])[0];
    if (!tpl) return { error: "шаблон не найден (template_id)", status: 404 };
    tplNodes = tpl.nodes || [];
    format = format || String(tpl.format_type || "");
    niche = niche || String(tpl.niche || "");
    srcVideoId = tpl.source_viral_video_id ?? null;
  }
  if (!tplNodes.length) return { error: "нет нод: передай template_id или nodes", status: 400 };

  niche = nicheFromArticle(article, productName) || niche; // ключ по нашему товару

  const { data: rec, error: rErr } = await db.from("node_recipes").insert({
    article, niche, mode, format_detected: format || null,
    source_viral_video_id: srcVideoId, built_by: "manual", status: "draft", recipe_confidence: 1,
  }).select("id").limit(1);
  if (rErr) return { error: "node_recipes: " + rErr.message, hint: "миграция 20260620_factory_v3 применена?", status: 500 };
  const recipeId = rec[0].id;

  const rows = tplNodes.map((n, i) => ({
    recipe_id: recipeId,
    ordinal: typeof n.ordinal === "number" ? n.ordinal : i + 1,
    slot: roleToSlot(n),
    node_type: n.node_type || null,
    tool: n.tool_candidate || n.tool || null,
    prompt: "", params: {}, asset_url: "",          // ОБНУЛЕНО под твой товар
    duration_sec: typeof n.duration_sec === "number" ? n.duration_sec : null,
    source: "transferred_from_corpus", human_edited: false,
    agent_suggestion: { role: n.role, hook_type: n.hook_type, onscreen_text: n.onscreen_text, voiceover: n.voiceover, emotion: n.emotion, visual_desc: n.visual_desc },
  }));
  const { error: nErr } = await db.from("node_recipe_nodes").insert(rows);
  if (nErr) return { error: "node_recipe_nodes: " + nErr.message, status: 500 };

  const graph_doc = {
    nodes: rows.map((r, i) => ({ id: `n${r.ordinal}`, type: r.node_type, slot: r.slot, tool: r.tool, position: { x: i * 240, y: 0 }, duration_sec: r.duration_sec, ref: r.agent_suggestion, status: "draft" })),
    edges: rows.slice(1).map((r, i) => ({ id: `e${i}`, source: `n${rows[i].ordinal}`, target: `n${r.ordinal}` })),
  };
  await db.from("node_recipes").update({ graph_doc }).eq("id", recipeId);

  return { ok: true, recipe_id: recipeId, niche, format, nodes_count: rows.length, graph_doc };
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const recipeId = sp.get("recipe_id");
    if (recipeId) {
      const [head, nodes] = await Promise.all([
        db.from("node_recipes").select("*").eq("id", recipeId).limit(1),
        db.from("node_recipe_nodes").select("*").eq("recipe_id", recipeId).order("ordinal"),
      ]);
      const recipe = (head.data as Record<string, unknown>[] | null)?.[0];
      if (!recipe) return NextResponse.json({ error: "рецепт не найден" }, { status: 404 });
      return NextResponse.json({ ok: true, recipe, nodes: nodes.data ?? [] });
    }
    // перенос через GET (удобный тест)
    if (sp.get("template_id") && sp.get("article")) {
      const r = await transfer(db, { template_id: sp.get("template_id")!, article: sp.get("article")!, product_name: sp.get("product_name") || undefined, mode: sp.get("mode") || undefined });
      return NextResponse.json(r, { status: (r as { status?: number }).status || ((r as { error?: string }).error ? 400 : 200) });
    }
    return NextResponse.json({ error: "нужен recipe_id (просмотр) или template_id+article (перенос)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "recipes crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const r = await transfer(db, body);
    return NextResponse.json(r, { status: (r as { status?: number }).status || ((r as { error?: string }).error ? 400 : 200) });
  } catch (e) {
    return NextResponse.json({ error: "recipes crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
