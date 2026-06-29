type DbClient = {
  from: (table: string) => any;
  storage?: {
    from: (bucket: string) => {
      list: (path?: string, options?: Record<string, unknown>) => PromiseLike<{ data?: unknown[] | null; error?: { message?: string } | null }>;
    };
  };
};

type RetentionClass = "keep" | "compact" | "expire" | "review";

type TableSpec = {
  table: string;
  category: "video_bank" | "execution" | "reels_brain" | "publication" | "configuration";
  role: string;
  retention: RetentionClass;
  mvpCritical: boolean;
  hasCreatedAt?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const FACTORY_DATA_TABLES: TableSpec[] = [
  { table: "content_assets", category: "video_bank", role: "final/generated/prepared assets plus product media pointers", retention: "keep", mvpCritical: true },
  { table: "generation_history", category: "execution", role: "attempt lineage for renders, saves, cache hits and failures", retention: "compact", mvpCritical: true },
  { table: "node_recipes", category: "execution", role: "recipe queue, run plan and current execution state", retention: "compact", mvpCritical: true },
  { table: "node_recipe_nodes", category: "execution", role: "per-node execution graph and render steps", retention: "compact", mvpCritical: true },
  { table: "cf_signals", category: "reels_brain", role: "approved/rejected/warning learning events", retention: "compact", mvpCritical: true },
  { table: "viral_videos", category: "reels_brain", role: "reference corpus from market/reels research", retention: "review", mvpCritical: true },
  { table: "viral_hooks", category: "reels_brain", role: "distilled hooks and winner seeds", retention: "keep", mvpCritical: true },
  { table: "niche_playbooks", category: "reels_brain", role: "aggregated niche rules and pattern memory", retention: "keep", mvpCritical: true },
  { table: "factory_publications", category: "publication", role: "publication ledger and external post mapping", retention: "keep", mvpCritical: true },
  { table: "factory_ugc_jobs", category: "publication", role: "UGC provider job ledger", retention: "compact", mvpCritical: false },
  { table: "post_metrics", category: "publication", role: "market feedback after publication", retention: "keep", mvpCritical: true },
  { table: "reel_variants", category: "execution", role: "variant experiments and render candidates", retention: "expire", mvpCritical: false },
  { table: "node_previews", category: "execution", role: "operator previews and preview cache", retention: "expire", mvpCritical: false },
  { table: "batch_builds", category: "execution", role: "batch orchestration snapshots", retention: "compact", mvpCritical: false },
  { table: "orbit_searches", category: "reels_brain", role: "raw reference searches before distillation", retention: "expire", mvpCritical: false },
  { table: "niche_monitors", category: "reels_brain", role: "trend monitoring snapshots", retention: "compact", mvpCritical: false },
  { table: "niche_visual_profiles", category: "reels_brain", role: "visual profile summaries", retention: "keep", mvpCritical: false },
  { table: "brand_kits", category: "configuration", role: "brand settings and visual constraints", retention: "keep", mvpCritical: true },
  { table: "factory_personas", category: "configuration", role: "consented stock/persona render settings", retention: "keep", mvpCritical: true },
];

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function safeError(error: unknown): string {
  const err = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null;
  const parts = [err?.message, err?.details, err?.hint, err?.code]
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") return JSON.stringify(part);
      return part == null ? "" : String(part);
    })
    .filter(Boolean);
  if (parts.length) return parts.join(" · ").slice(0, 220);
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error).slice(0, 220);
    } catch {
      return "unserializable error";
    }
  }
  return String(error || "unknown").slice(0, 220);
}

async function safeCount(db: DbClient, spec: TableSpec) {
  try {
    const res = await db.from(spec.table).select("id", { count: "exact", head: true });
    if (res?.error) return { table: spec.table, count: null, warning: `${spec.table}: ${safeError(res.error)}` };
    return { table: spec.table, count: Number(res?.count || 0), warning: null };
  } catch (error) {
    return { table: spec.table, count: null, warning: `${spec.table}: ${safeError(error)}` };
  }
}

async function safeRecentCount(db: DbClient, table: string, since: string) {
  try {
    const res = await db.from(table).select("id", { count: "exact", head: true }).gte("created_at", since);
    if (res?.error) return { count: null, warning: safeError(res.error) };
    return { count: Number(res?.count || 0), warning: null };
  } catch (error) {
    return { count: null, warning: safeError(error) };
  }
}

async function safeStorageSample(db: DbClient, bucket: string, prefix: string) {
  if (!db.storage) return { bucket, prefix, sample_count: 0, warning: "Supabase storage client is unavailable" };
  try {
    const res = await db.storage.from(bucket).list(prefix, {
      limit: 100,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (res?.error) return { bucket, prefix, sample_count: 0, warning: `${prefix}: ${safeError(res.error)}` };
    return {
      bucket,
      prefix,
      sample_count: Array.isArray(res?.data) ? res.data.length : 0,
      warning: null,
    };
  } catch (error) {
    return { bucket, prefix, sample_count: 0, warning: `${prefix}: ${safeError(error)}` };
  }
}

function summarizeByCategory(rows: Array<TableSpec & { count: number | null }>) {
  const out: Record<string, { tables: number; known_rows: number; unknown_tables: number }> = {};
  for (const row of rows) {
    const item = out[row.category] || { tables: 0, known_rows: 0, unknown_tables: 0 };
    item.tables += 1;
    if (row.count == null) item.unknown_tables += 1;
    else item.known_rows += row.count;
    out[row.category] = item;
  }
  return out;
}

export async function loadFactoryDataFootprint(db: DbClient | null | undefined) {
  if (!db) {
    return {
      ok: true,
      destructive: false,
      ready: false,
      generated_at: new Date().toISOString(),
      warnings: ["Supabase is not configured"],
      tables: [],
      by_category: {},
      storage: [],
      retention_policy: buildRetentionPolicy(),
      risks: buildRisks(),
    };
  }

  const d24 = isoAgo(DAY_MS);
  const d7 = isoAgo(7 * DAY_MS);
  const counted = await Promise.all(FACTORY_DATA_TABLES.map((spec) => safeCount(db, spec)));
  const tableRows = await Promise.all(FACTORY_DATA_TABLES.map(async (spec, index) => {
    const base = counted[index];
    const [recent24h, recent7d] = await Promise.all([
      safeRecentCount(db, spec.table, d24),
      safeRecentCount(db, spec.table, d7),
    ]);
    const warnings = [base.warning, recent24h.warning && `${spec.table} recent_24h: ${recent24h.warning}`, recent7d.warning && `${spec.table} recent_7d: ${recent7d.warning}`].filter(Boolean) as string[];
    return {
      ...spec,
      count: base.count,
      recent_24h: recent24h.count,
      recent_7d: recent7d.count,
      warnings,
    };
  }));

  const storage = await Promise.all([
    safeStorageSample(db, "factory-media", ""),
    safeStorageSample(db, "factory-media", "gen"),
    safeStorageSample(db, "factory-media", "clips"),
    safeStorageSample(db, "factory-media", "prepared"),
    safeStorageSample(db, "factory-media", "covers"),
  ]);

  const warnings = [
    ...tableRows.flatMap((row) => row.warnings),
    ...storage.map((row) => row.warning).filter(Boolean),
  ] as string[];

  return {
    ok: true,
    destructive: false,
    ready: warnings.length === 0,
    generated_at: new Date().toISOString(),
    warnings,
    tables: tableRows,
    by_category: summarizeByCategory(tableRows),
    storage,
    retention_policy: buildRetentionPolicy(),
    risks: buildRisks(),
  };
}

function buildRetentionPolicy() {
  return {
    keep: [
      "content_assets rows marked winner/approved or used by publications",
      "factory_publications and post_metrics market feedback",
      "viral_hooks, niche_playbooks, brand_kits and factory_personas",
    ],
    compact: [
      "generation_history older than 60-90 days into daily aggregates",
      "node_recipes/node_recipe_nodes after terminal status and exported lineage",
      "cf_signals older than 90 days after aggregation by niche/reason/outcome",
      "factory_ugc_jobs after provider output is linked to publication or asset",
    ],
    expire: [
      "failed preview rows and old reel_variants after 14-30 days",
      "raw orbit_searches after they are distilled into viral_videos/hooks",
      "orphaned factory-media/gen files with no content_assets/generation_history/publication reference",
    ],
    never_delete_without_backup: [
      "winner assets",
      "published assets",
      "post_metrics",
      "brand/persona/configuration rows",
      "raw rows needed to reproduce legal/paid publication decisions",
    ],
  };
}

function buildRisks() {
  return [
    "Supabase Storage may hold the heavy MP4 bytes while DB rows only store URLs and lineage.",
    "The same video URL can be referenced by content_assets, generation_history, node_recipes and factory_publications.",
    "Deleting DB rows before checking Storage references can orphan files or break the video bank.",
    "Deleting Storage before checking DB references can break studio playback and learning history.",
    "Unbounded generation_history/cf_signals/node_recipes growth is expected during batch work unless compacted.",
  ];
}
