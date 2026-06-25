function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

export async function loadObserverPulse(db: any) {
  const now = Date.now();
  const d24 = ago(24 * 3600e3);
  const d7 = ago(7 * 86400e3);
  const out: Record<string, unknown> = {
    ok: true,
    updated_at: new Date().toISOString(),
    partial: false,
  };

  try {
    const [
      lastR,
      g24,
      g7,
      sc,
      active,
      broken,
      batches,
      recent,
      resurrects,
      rejects,
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

    if (!lastR || !g24 || !g7 || !sc || !active || !broken || !batches || !recent || !resurrects || !rejects) {
      out.partial = true;
    }

    const lastAt = (lastR as { data?: { created_at?: string }[] | null } | null)?.data?.[0]?.created_at || null;
    if (lastAt) {
      const staleMin = Math.round((now - new Date(lastAt).getTime()) / 60000);
      out.heartbeat = { last_activity_at: lastAt, stale_min: staleMin, alive: staleMin < 180 };
    }

    out.gens = {
      last_24h: (g24 as { count?: number | null } | null)?.count ?? 0,
      last_7d: (g7 as { count?: number | null } | null)?.count ?? 0,
    };

    const scores = ((((sc as { data?: { otk_score: number | string }[] | null } | null)?.data) || []) as { otk_score: number | string }[])
      .map((row) => Number(row.otk_score))
      .filter((value) => Number.isFinite(value));
    if (scores.length) {
      out.otk = {
        avg_24h: Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10,
        pass_rate: Math.round((scores.filter((value) => value >= 7).length / scores.length) * 100) / 100,
        n: scores.length,
      };
    }

    out.runs = {
      active: (active as { count?: number | null } | null)?.count ?? 0,
      broken: (broken as { count?: number | null } | null)?.count ?? 0,
    };
    out.batches_active = (batches as { count?: number | null } | null)?.count ?? 0;
    out.signals = {
      recent: (((recent as { data?: { event: string; reason_chip: string | null; created_at: string }[] | null } | null)?.data) || []).map((row) => ({
        when: row.created_at,
        event: row.event,
        chip: row.reason_chip || null,
      })),
      resurrects_24h: (resurrects as { count?: number | null } | null)?.count ?? 0,
      rejects_24h: (rejects as { count?: number | null } | null)?.count ?? 0,
    };
  } catch {
    out.partial = true;
  }

  return out;
}
