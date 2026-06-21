import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allToolKeys } from "@/lib/factory/toolSchemas";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// §5 V3: сохранить ручную настройку ноды (промпт/параметры/инструмент/ассет) в node_recipe_nodes.
// КЛЮЧ ОБУЧЕНИЯ: ставит human_edited=true и пишет cf_signal (event "node_edited") — экспертиза владельца
// становится переиспользуемым сигналом дата-стека (manual → assisted → auto). Синхронит graph_doc.
//   POST { recipe_id, node_id, prompt?, params?, tool?, asset_url?, asset_id? } → { ok, node }
// Всегда JSON (обработчик в try/catch).
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const b = await req.json().catch(() => ({}));
    const nodeId = b.node_id;
    if (!nodeId) return NextResponse.json({ error: "нужен node_id" }, { status: 400 });

    // патч строки ноды — только переданные поля
    const patch: Record<string, unknown> = { human_edited: true, source: "human_chosen" };
    if (typeof b.prompt === "string") patch.prompt = b.prompt;
    if (b.params && typeof b.params === "object") patch.params = b.params;
    // защита: tool пишем ТОЛЬКО если это известный инструмент — пустая/чужая строка не должна затирать tool ноды
    if (typeof b.tool === "string" && b.tool && allToolKeys().includes(b.tool)) patch.tool = b.tool;
    if (typeof b.asset_url === "string") patch.asset_url = b.asset_url;
    if (b.asset_id != null) patch.asset_id = b.asset_id;
    // disk_real пишет длительность в params — продублируем в колонку duration_sec (её читает таймлайн/сборка)
    if (b.params && typeof b.params.duration_sec === "number") patch.duration_sec = b.params.duration_sec;

    const { data, error } = await db.from("node_recipe_nodes").update(patch).eq("id", nodeId).select("*").limit(1);
    if (error) return NextResponse.json({ error: "node_recipe_nodes: " + error.message }, { status: 500 });
    const node = (data as Record<string, unknown>[] | null)?.[0];
    if (!node) return NextResponse.json({ error: "нода не найдена" }, { status: 404 });

    const recipeId = b.recipe_id || node.recipe_id;

    // синхронизируем graph_doc (статус ноды → ready/configured) + niche/article для сигнала
    let niche: string | null = null, article: string | null = null;
    try {
      const { data: rec } = await db.from("node_recipes").select("graph_doc,niche,article").eq("id", recipeId).limit(1);
      const r = (rec as Record<string, unknown>[] | null)?.[0];
      if (r) {
        niche = (r.niche as string) || null; article = (r.article as string) || null;
        const gd = (r.graph_doc && typeof r.graph_doc === "object") ? r.graph_doc as { nodes?: Record<string, unknown>[] } : null;
        if (gd && Array.isArray(gd.nodes)) {
          const gn = gd.nodes.find((x) => String(x.id) === `n${node.ordinal}` || x.node_id === nodeId);
          if (gn) { gn.status = "configured"; gn.tool = patch.tool ?? gn.tool; await db.from("node_recipes").update({ graph_doc: gd, updated_at: new Date().toISOString() }).eq("id", recipeId); }
        }
      }
    } catch { /* graph_doc-синк best-effort */ }

    // журнал обучения: ручная правка ноды
    try {
      await db.from("cf_signals").insert({
        event: "node_edited", recipe_id: recipeId, node_id: nodeId,
        slot: node.slot, tool: patch.tool ?? node.tool, params: patch.params ?? node.params,
        niche, article, reason_chip: null,
      });
    } catch { /* журнал best-effort */ }

    return NextResponse.json({ ok: true, node });
  } catch (e) {
    return NextResponse.json({ error: "node-save crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
