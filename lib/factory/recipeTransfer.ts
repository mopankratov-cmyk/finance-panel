import { nicheFromArticle } from "./rubric";

type DbClient = {
  from: (table: string) => any;
};

type TransferInput = {
  template_id?: string | number;
  nodes?: Record<string, unknown>[];
  article: string;
  product_name?: string;
  niche?: string;
  mode?: string;
  format?: string;
  built_by?: string;
  force_niche?: boolean;
};

function specializeText(value: unknown, p: { article: string; productName: string }): string {
  const source = String(value || "");
  if (!source) return "";
  const product = p.productName || p.article;
  return source
    .replace(/\{\{\s*article\s*\}\}|\{\s*article\s*\}|\[\s*article\s*\]/gi, p.article)
    .replace(/\{\{\s*product(?:_name)?\s*\}\}|\{\s*product(?:_name)?\}|\[\s*product(?:_name)?\]/gi, product)
    .replace(/\{\{\s*товар\s*\}\}|\{\s*товар\s*\}|\[\s*товар\s*\]/gi, product)
    .replace(/\{\{\s*артикул\s*\}\}|\{\s*артикул\s*\}|\[\s*артикул\s*\]/gi, p.article)
    .slice(0, 1500);
}

function roleToSlot(n: Record<string, unknown>): string {
  const r = String(n?.role || "").toLowerCase();
  const t = String(n?.node_type || "").toLowerCase();
  if (t === "captions") return "caption";
  if (t === "music" || t === "sound") return "music";
  if (t === "transition") return "transition";
  if (r === "hook") return "hook";
  if (r === "cta") return "payoff";
  return "scene";
}

export async function transferRecipeTemplate(db: DbClient, p: TransferInput) {
  const article = (p.article || "").toString().trim();
  if (!article) return { error: "нужен article (товар, под который переносим)", status: 400 };
  const productName = (p.product_name || "").toString().trim();
  const mode = p.mode === "sell" ? "sell" : "audience";

  let tplNodes: Record<string, unknown>[] = Array.isArray(p.nodes) ? p.nodes : [];
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

  niche = p.force_niche ? (niche || nicheFromArticle(article, productName)) : (nicheFromArticle(article, productName) || niche);

  const { data: rec, error: rErr } = await db.from("node_recipes").insert({
    article,
    niche,
    mode,
    format_detected: format || null,
    source_viral_video_id: srcVideoId,
    built_by: p.built_by || "manual",
    status: "draft",
    recipe_confidence: 1,
  }).select("id").limit(1);
  if (rErr) return { error: "node_recipes: " + rErr.message, hint: "миграция 20260620_factory_v3 применена?", status: 500 };
  const recipeId = rec[0].id;

  const rows = tplNodes.map((n, i) => {
    const params = n.params && typeof n.params === "object" && !Array.isArray(n.params) ? n.params as Record<string, unknown> : {};
    const specialized = { article, productName };
    const onscreenText = specializeText(n.onscreen_text, specialized).slice(0, 300);
    const visualDesc = specializeText(n.visual_desc, specialized).slice(0, 300);
    const voiceover = specializeText(n.voiceover, specialized).slice(0, 700);
    return {
      recipe_id: recipeId,
      ordinal: typeof n.ordinal === "number" ? n.ordinal : i + 1,
      slot: roleToSlot(n),
      node_type: n.node_type || null,
      tool: n.tool_candidate || n.tool || null,
      prompt: specializeText(n.prompt || voiceover || visualDesc || "", specialized),
      params: {
        ...params,
        product_article: article,
        product_name: productName || null,
        ...(onscreenText ? { onscreen_text: onscreenText } : {}),
        ...(n.role ? { role: String(n.role).toLowerCase() } : {}),
        ...(n.emotion ? { emotion: String(n.emotion) } : {}),
        ...(visualDesc ? { visual_desc: visualDesc } : {}),
      },
      asset_url: "",
      duration_sec: typeof n.duration_sec === "number" ? n.duration_sec : null,
      source: "transferred_from_corpus",
      human_edited: false,
      agent_suggestion: { role: n.role, hook_type: n.hook_type, onscreen_text: onscreenText || n.onscreen_text, voiceover: voiceover || n.voiceover, emotion: n.emotion, visual_desc: visualDesc || n.visual_desc, product_article: article, product_name: productName || null },
    };
  });
  const { error: nErr } = await db.from("node_recipe_nodes").insert(rows);
  if (nErr) {
    await db.from("node_recipes").delete().eq("id", recipeId);
    return { error: "node_recipe_nodes: " + nErr.message, status: 500 };
  }

  const graph_doc = {
    nodes: rows.map((r, i) => ({ id: `n${r.ordinal}`, type: r.node_type, slot: r.slot, tool: r.tool, position: { x: i * 240, y: 0 }, duration_sec: r.duration_sec, ref: r.agent_suggestion, status: "draft" })),
    edges: rows.slice(1).map((r, i) => ({ id: `e${i}`, source: `n${rows[i].ordinal}`, target: `n${r.ordinal}` })),
  };
  await db.from("node_recipes").update({ graph_doc }).eq("id", recipeId);

  return { ok: true, recipe_id: recipeId, niche, format, nodes_count: rows.length, graph_doc };
}
