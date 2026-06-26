import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { submitNode, pollNode, nodeHash, type EngineNode } from "@/lib/factory/nodeEngine";
import { logGeneration } from "@/lib/factory/genHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// §6 V3: ПРЕВЬЮ ОДНОЙ НОДЫ с хэш-кэшем. Калибровка инструмента «вживую» без сборки всего графа.
//   POST { tool, node_type?, prompt?, params?, image_url?, asset_url?, duration_sec?, recipe_id?, node_id?, force? }
//        → кэш-хит { cached:true, status:"done", url } | сабмит { status:"in_progress", token, preview_id, engine }
//        → мгновенно { status:"done", url } для disk_real/готового ассета
//   GET  ?token=  → опрос движка; на done пишет кэш + cf_signal; { status, url }
//   GET  ?preview_id= → состояние из кэша
//   GET  ?hash=   → есть ли готовое превью в кэше
// Всегда JSON (обработчик в try/catch). Хэш-кэш мягко деградирует, если таблица node_previews не применена.


async function logSignal(db: any, ev: string, extra: Record<string, unknown>) {
  if (!db) return;
  try { await db.from("cf_signals").insert({ event: ev, ...extra }); } catch { /* журнал best-effort */ }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const node: EngineNode = {
      tool: body.tool, node_type: body.node_type, prompt: body.prompt,
      params: body.params || {}, image_url: body.image_url, asset_url: body.asset_url,
      duration_sec: typeof body.duration_sec === "number" ? body.duration_sec : undefined,
    };
    if (!node.tool && !node.asset_url) return NextResponse.json({ error: "нужен tool (или asset_url)" }, { status: 400 });

    const hash = nodeHash(node);

    // 1) кэш-хит (если таблица есть и не force)
    if (db && !body.force) {
      try {
        const { data } = await db.from("node_previews").select("*").eq("hash", hash).eq("status", "done").limit(1);
        const hit = (data as Record<string, unknown>[] | null)?.[0];
        if (hit?.output_url) {
          await logGeneration({
            recipe_id: body.recipe_id ?? null,
            node_id: body.node_id ?? null,
            tool: node.tool,
            engine: (hit.engine as string) ?? null,
            node_type: node.node_type,
            prompt: node.prompt,
            params: node.params,
            output_url: String(hit.output_url),
            cost_hint: (hit.cost_hint as string) ?? null,
            status: "generated",
            source: "node_preview",
            reason: "cache_hit",
          });
          return NextResponse.json({ ok: true, cached: true, status: "done", url: hit.output_url, hash, engine: hit.engine, preview_id: hit.id });
        }
      } catch { /* таблица не применена — без кэша */ }
    }

    // 2) сабмит на движок
    const r = await submitNode(node);
    if (r.error) return NextResponse.json({ error: r.error, engine: r.engine, hash }, { status: 400 });

    // disk_real/asset — готово сразу
    if (r.done && r.url) {
      let preview_id: number | null = null;
      if (db) { try { const { data } = await db.from("node_previews").upsert({ hash, tool: node.tool, engine: r.engine, node_type: node.node_type, recipe_id: body.recipe_id ?? null, node_id: body.node_id ?? null, status: "done", output_url: r.url, cost_hint: r.cost_hint, updated_at: new Date().toISOString() }, { onConflict: "hash" }).select("id").limit(1); preview_id = (data as { id: number }[] | null)?.[0]?.id ?? null; } catch { /* без кэша */ } }
      // V20 · память итераций (мгновенный движок: disk_real/asset)
      await logGeneration({ recipe_id: body.recipe_id ?? null, node_id: body.node_id ?? null, tool: node.tool, engine: r.engine, node_type: node.node_type, prompt: node.prompt, params: node.params, output_url: r.url, cost_hint: r.cost_hint, status: "generated", source: "node_preview" });
      return NextResponse.json({ ok: true, cached: false, status: "done", url: r.url, engine: r.engine, hash, preview_id, cost_hint: r.cost_hint });
    }

    // async — пишем in_progress + токен в кэш, отдаём токен на опрос
    let preview_id: number | null = null;
    if (db && r.token) {
      try {
        const { data } = await db.from("node_previews").upsert({ hash, tool: node.tool, engine: r.engine, node_type: node.node_type, recipe_id: body.recipe_id ?? null, node_id: body.node_id ?? null, token: r.token, status: "in_progress", cost_hint: r.cost_hint, updated_at: new Date().toISOString() }, { onConflict: "hash" }).select("id").limit(1);
        preview_id = (data as { id: number }[] | null)?.[0]?.id ?? null;
      } catch { /* без кэша — токена в ответе достаточно для опроса */ }
    }
    await logSignal(db, "node_preview", { tool: node.tool, slot: node.node_type, recipe_id: body.recipe_id ?? null, params: node.params });
    return NextResponse.json({ ok: true, cached: false, status: "in_progress", token: r.token, engine: r.engine, hash, preview_id, cost_hint: r.cost_hint });
  } catch (e) {
    return NextResponse.json({ error: "превью ноды упало: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const sp = req.nextUrl.searchParams;
    const token = sp.get("token");
    const previewId = sp.get("preview_id");
    const hash = sp.get("hash");

    if (hash && db) {
      try {
        const { data } = await db.from("node_previews").select("*").eq("hash", hash).limit(1);
        const row = (data as Record<string, unknown>[] | null)?.[0];
        if (row) return NextResponse.json({ ok: true, status: row.status, url: row.output_url, engine: row.engine, preview_id: row.id, cached: row.status === "done" });
      } catch { /* нет таблицы */ }
      return NextResponse.json({ ok: true, status: "miss" });
    }

    if (previewId && db) {
      const { data } = await db.from("node_previews").select("*").eq("id", previewId).limit(1);
      const row = (data as Record<string, unknown>[] | null)?.[0];
      if (!row) return NextResponse.json({ error: "превью не найдено" }, { status: 404 });
      if (row.status === "done" || row.status === "error") return NextResponse.json({ ok: true, status: row.status, url: row.output_url, error: row.error });
      // ещё в работе → опросим по токену
      if (row.token) return await pollAndPersist(db, String(row.token), Number(row.id));
      return NextResponse.json({ ok: true, status: row.status });
    }

    if (token) {
      return await pollAndPersist(db, token, null);
    }
    return NextResponse.json({ error: "нужен token, preview_id или hash" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "превью ноды упало: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}


async function pollAndPersist(db: any, token: string, previewId: number | null) {
  const s = await pollNode(token);
  if (db && (s.status === "done" || s.status === "error")) {
    try {
      const patch = { status: s.status, output_url: s.url || null, error: s.error || null, updated_at: new Date().toISOString() };
      if (previewId) await db.from("node_previews").update(patch).eq("id", previewId);
      else await db.from("node_previews").update(patch).eq("token", token);
    } catch { /* без кэша */ }
    if (s.status === "done") {
      await logSignal(db, "node_preview_done", {});
      // V20 · память итераций: async-генерация (fal/creatify) завершилась — тянем контекст из node_previews и пишем
      try {
        const q = previewId ? db.from("node_previews").select("*").eq("id", previewId) : db.from("node_previews").select("*").eq("token", token);
        const { data } = await q.limit(1);
        const row = (data as Record<string, unknown>[] | null)?.[0];
        if (row) await logGeneration({ recipe_id: (row.recipe_id as number) ?? null, node_id: (row.node_id as number) ?? null, tool: (row.tool as string) ?? null, engine: (row.engine as string) ?? null, node_type: (row.node_type as string) ?? null, output_url: s.url || null, cost_hint: (row.cost_hint as string) ?? null, status: "generated", source: "node_preview" });
      } catch { /* история best-effort */ }
    }
  }
  return NextResponse.json({ ok: true, status: s.status, url: s.url, error: s.error });
}
