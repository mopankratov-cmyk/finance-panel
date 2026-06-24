import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Read-only оперативный «пульс» завода для ВНЕШНЕГО наблюдателя (Rita / director-cockpit).
// GET /api/factory/observer → { ok, updated_at, heartbeat, gens, otk, runs, batches_active, signals }
// Ничего не пишет в БД и не дёргает платные внешние API (в отличие от /balances).
// Защитно: отсутствие таблицы/колонки → секция опускается, эндпоинт не падает (паттерн /status).
// Деньги намеренно НЕ здесь — для них у наблюдателя есть отдельный /api/factory/balances.

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const now = Date.now();
    const d24 = ago(24 * 3600e3);
    const d7 = ago(7 * 86400e3);
    const out: Record<string, unknown> = { ok: true, updated_at: new Date().toISOString(), partial: false };

    // ── Пульс + пропускная способность + ОТК + активные прогоны + сигналы ──
    try {
      const [
        lastR, g24, g7, sc,
        active, broken, b,
        recent, resurrects, rejects,
      ] = await Promise.all([
        withTimeout(db.from("generation_history").select("created_at").order("created_at", { ascending: false }).limit(1), 1800),
        withTimeout(db.from("generation_history").select("id", { count: "exact", head: true }).gte("created_at", d24), 1800),
        withTimeout(db.from("generation_history").select("id", { count: "exact", head: true }).gte("created_at", d7), 1800),
        withTimeout(db.from("generation_history").select("otk_score").gte("created_at", d24).not("otk_score", "is", null).limit(1000), 1800),
        withTimeout(db.from("node_recipe_nodes").select("id", { count: "exact", head: true }).in("status", ["running", "in_progress", "queued", "pending", "regen"]), 1800),
        withTimeout(db.from("node_recipe_nodes").select("id", { count: "exact", head: true }).in("status", ["error", "run_fail"]), 1800),
        withTimeout(db.from("batch_builds").select("id", { count: "exact", head: true }).eq("status", "building"), 1800),
        withTimeout(db.from("cf_signals").select("event,reason_chip,created_at").gte("created_at", d24).order("created_at", { ascending: false }).limit(8), 1800),
        withTimeout(db.from("cf_signals").select("id", { count: "exact", head: true }).gte("created_at", d24).eq("event", "graph_resurrect"), 1800),
        withTimeout(db.from("cf_signals").select("id", { count: "exact", head: true }).gte("created_at", d24).eq("event", "rejected"), 1800),
      ]);

      if (!lastR || !g24 || !g7 || !sc || !active || !broken || !b || !recent || !resurrects || !rejects) out.partial = true;

      const lastAt = (lastR?.data?.[0] as { created_at?: string } | undefined)?.created_at || null;
      if (lastAt) {
        const staleMin = Math.round((now - new Date(lastAt).getTime()) / 60000);
        out.heartbeat = { last_activity_at: lastAt, stale_min: staleMin, alive: staleMin < 180 };
      }
      out.gens = { last_24h: g24?.count ?? 0, last_7d: g7?.count ?? 0 };
      const arr = ((sc?.data || []) as { otk_score: number | string }[]).map((s) => Number(s.otk_score)).filter((n) => Number.isFinite(n));
      if (arr.length) {
        out.otk = {
          avg_24h: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10,
          pass_rate: Math.round((arr.filter((n) => n >= 7).length / arr.length) * 100) / 100,
          n: arr.length,
        };
      }
      out.runs = { active: active?.count ?? 0, broken: broken?.count ?? 0 };
      out.batches_active = b?.count ?? 0;
      out.signals = {
        recent: ((recent?.data || []) as { event: string; reason_chip: string | null; created_at: string }[])
          .map((s) => ({ when: s.created_at, event: s.event, chip: s.reason_chip || null })),
        resurrects_24h: resurrects?.count ?? 0, // прогоны зависали и воскрешались краном → сигнал нездоровья
        rejects_24h: rejects?.count ?? 0, // ОТК отбраковал
      };
    } catch { out.partial = true; /* секция опускается */ }

    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "observer crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
