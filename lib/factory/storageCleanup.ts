type DbClient = {
  from: (table: string) => any;
  storage?: {
    from: (bucket: string) => {
      list: (path?: string, options?: Record<string, unknown>) => PromiseLike<{ data?: StorageItem[] | null; error?: { message?: string } | null }>;
      remove?: (paths: string[]) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
    };
  };
};

type StorageItem = {
  name?: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: { size?: number; mimetype?: string; [key: string]: unknown } | null;
};

type Reference = {
  table: string;
  row_id: string | number | null;
  field: string;
  url: string;
  protected: boolean;
  reason: string;
};

const BUCKET = "factory-media";
const STORAGE_PREFIXES = ["gen", "clips", "prepared", "covers", "voiceover"];
const DEFAULT_LIMIT = 500;
const DEFAULT_STORAGE_LIMIT = 1000;
const URL_RE = /https?:\/\/[^\s"'<>\\)]+/gi;

function safeError(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error || "unknown").slice(0, 220);
}

function normalizeUrl(url: unknown): string {
  return String(url || "").trim().replace(/[),.;]+$/g, "");
}

function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
}

function collectUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return Array.from(value.matchAll(URL_RE)).map((m) => normalizeUrl(m[0]));
  if (Array.isArray(value)) return value.flatMap((item) => collectUrls(item));
  if (typeof value === "object") return collectUrls(JSON.stringify(value));
  return [];
}

function addReference(refs: Reference[], input: {
  table: string;
  row_id: string | number | null;
  field: string;
  value: unknown;
  protected: boolean;
  reason: string;
}) {
  for (const url of collectUrls(input.value)) {
    refs.push({
      table: input.table,
      row_id: input.row_id,
      field: input.field,
      url,
      protected: input.protected,
      reason: input.reason,
    });
  }
}

async function safeSelect(db: DbClient, table: string, select: string, limit: number) {
  try {
    const res = await db.from(table).select(select).order("created_at", { ascending: false }).limit(limit);
    if (res?.error) return { rows: [], warning: `${table}: ${safeError(res.error)}` };
    return { rows: (res?.data as Record<string, unknown>[] | null) || [], warning: null };
  } catch (error) {
    return { rows: [], warning: `${table}: ${safeError(error)}` };
  }
}

async function safeStorageList(db: DbClient, prefix: string, limit: number) {
  if (!db.storage) return { rows: [], warning: `${prefix}: Supabase storage client is unavailable` };
  try {
    const res = await db.storage.from(BUCKET).list(prefix, {
      limit,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (res?.error) return { rows: [], warning: `${prefix}: ${safeError(res.error)}` };
    return { rows: (res?.data || []).map((item) => ({ ...item, prefix })), warning: null };
  } catch (error) {
    return { rows: [], warning: `${prefix}: ${safeError(error)}` };
  }
}

function rowId(row: Record<string, unknown>): string | number | null {
  return (row.id as string | number | undefined) ?? null;
}

function contentAssetProtected(row: Record<string, unknown>): { protected: boolean; reason: string } {
  const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Record<string, unknown> : {};
  if (row.is_winner || row.winner_at) return { protected: true, reason: "winner asset" };
  if (analysis.yandex_archive_url) return { protected: true, reason: "already archived to yandex" };
  if (Number(analysis.otk ?? analysis.otk_score ?? 0) >= 7) return { protected: true, reason: "OTK pass/usable asset" };
  return { protected: false, reason: "generated asset reference" };
}

function recipeProtected(row: Record<string, unknown>): { protected: boolean; reason: string } {
  const status = String(row.status || "");
  if (["running", "queued", "pending", "regen"].includes(status)) return { protected: true, reason: `active recipe ${status}` };
  if (["otk_pass", "posted", "approved"].includes(status)) return { protected: true, reason: `terminal keeper ${status}` };
  return { protected: false, reason: `recipe ${status || "unknown"}` };
}

async function loadReferences(db: DbClient, limit: number) {
  const warnings: string[] = [];
  const refs: Reference[] = [];
  const [
    assets,
    history,
    recipes,
    publications,
    ugcJobs,
  ] = await Promise.all([
    safeSelect(db, "content_assets", "id,url,path,kind,disk,analysis,is_winner,winner_at,created_at", limit),
    safeSelect(db, "generation_history", "id,input_url,output_url,video_url,status,reason,created_at", limit),
    safeSelect(db, "node_recipes", "id,status,output_url,run_plan,graph_doc,created_at", Math.min(limit, 250)),
    safeSelect(db, "factory_publications", "id,source_url,published_url,status,created_at", limit),
    safeSelect(db, "factory_ugc_jobs", "id,output_url,status,created_at", limit),
  ]);
  for (const block of [assets, history, recipes, publications, ugcJobs]) {
    if (block.warning) warnings.push(block.warning);
  }

  for (const row of assets.rows) {
    const p = contentAssetProtected(row);
    addReference(refs, { table: "content_assets", row_id: rowId(row), field: "url", value: row.url, protected: p.protected, reason: p.reason });
    addReference(refs, { table: "content_assets", row_id: rowId(row), field: "analysis", value: row.analysis, protected: p.protected, reason: p.reason });
  }
  for (const row of history.rows) {
    const status = String(row.status || "");
    const protectedRef = ["generated", "approved", "posted"].includes(status);
    for (const field of ["input_url", "output_url", "video_url"]) {
      addReference(refs, { table: "generation_history", row_id: rowId(row), field, value: row[field], protected: protectedRef, reason: `generation ${status || "unknown"}` });
    }
  }
  for (const row of recipes.rows) {
    const p = recipeProtected(row);
    for (const field of ["output_url", "run_plan", "graph_doc"]) {
      addReference(refs, { table: "node_recipes", row_id: rowId(row), field, value: row[field], protected: p.protected, reason: p.reason });
    }
  }
  for (const row of publications.rows) {
    const status = String(row.status || "");
    const protectedRef = status !== "failed";
    for (const field of ["source_url", "published_url"]) {
      addReference(refs, { table: "factory_publications", row_id: rowId(row), field, value: row[field], protected: protectedRef, reason: `publication ${status || "unknown"}` });
    }
  }
  for (const row of ugcJobs.rows) {
    const status = String(row.status || "");
    const protectedRef = ["done", "published"].includes(status);
    addReference(refs, { table: "factory_ugc_jobs", row_id: rowId(row), field: "output_url", value: row.output_url, protected: protectedRef, reason: `ugc job ${status || "unknown"}` });
  }

  return { refs, warnings };
}

function summarizeReferenceGraph(refs: Reference[]) {
  const byTable: Record<string, number> = {};
  const byPath = new Map<string, Reference[]>();
  for (const ref of refs) {
    byTable[ref.table] = (byTable[ref.table] || 0) + 1;
    const path = storagePathFromUrl(ref.url);
    if (!path) continue;
    const rows = byPath.get(path) || [];
    rows.push(ref);
    byPath.set(path, rows);
  }
  return { byTable, byPath };
}

function yandexArchiveInfo(row: Record<string, unknown>) {
  const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Record<string, unknown> : {};
  const archivedAt = String(analysis.yandex_archived_at || "").trim();
  const archivePath = String(analysis.yandex_archive_path || "").trim();
  const archiveUrl = String(analysis.yandex_archive_url || "").trim();
  return { archivedAt, archivePath, archiveUrl, ready: !!archivedAt && !!archivePath };
}

function classifyStorageItem(item: StorageItem & { prefix?: string }, refs: Reference[]) {
  const prefix = item.prefix || "";
  const path = `${prefix}/${item.name || ""}`.replace(/^\/+/, "");
  const protectedRefs = refs.filter((ref) => ref.protected);
  const status = refs.length === 0
    ? "orphan_candidate"
    : protectedRefs.length
      ? "protected"
      : "referenced_review";
  return {
    path,
    name: item.name || "",
    prefix,
    size_bytes: Number(item.metadata?.size || 0) || null,
    mimetype: item.metadata?.mimetype || null,
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    status,
    reference_count: refs.length,
    protected_reference_count: protectedRefs.length,
    references: refs.slice(0, 8).map((ref) => ({
      table: ref.table,
      row_id: ref.row_id,
      field: ref.field,
      protected: ref.protected,
      reason: ref.reason,
    })),
  };
}

function buildYandexArchivedReleaseCandidates(
  rows: Record<string, unknown>[],
  storageByPath: Map<string, ReturnType<typeof classifyStorageItem>>,
) {
  return rows
    .map((row) => {
      const url = normalizeUrl(row.url);
      const storagePath = storagePathFromUrl(url);
      const archive = yandexArchiveInfo(row);
      const item = storagePath ? storageByPath.get(storagePath) : null;
      return {
        id: rowId(row),
        kind: String(row.kind || ""),
        disk: String(row.disk || ""),
        storage_path: storagePath,
        size_bytes: item?.size_bytes || null,
        yandex_archive_path: archive.archivePath,
        yandex_archive_url: archive.archiveUrl || null,
        yandex_archived_at: archive.archivedAt,
        ready_for_storage_release: !!storagePath && archive.ready,
      };
    })
    .filter((row) => row.ready_for_storage_release)
    .slice(0, 200);
}

export async function buildFactoryStorageCleanupDryRun(db: DbClient | null | undefined, input?: {
  limit?: number;
  storageLimit?: number;
}) {
  const limit = Math.min(Math.max(Number(input?.limit || DEFAULT_LIMIT), 50), 2000);
  const storageLimit = Math.min(Math.max(Number(input?.storageLimit || DEFAULT_STORAGE_LIMIT), 50), 5000);
  if (!db) {
    return {
      ok: true,
      destructive: false,
      ready: false,
      apply: false,
      warnings: ["Supabase is not configured"],
      reference_graph: { total_references: 0, storage_references: 0, by_table: {} },
      storage: { scanned: 0, protected: 0, referenced_review: 0, orphan_candidates: 0, estimated_orphan_bytes: 0 },
      candidates: [],
    };
  }

  const [{ refs, warnings: refWarnings }, ...storageBlocks] = await Promise.all([
    loadReferences(db, limit),
    ...STORAGE_PREFIXES.map((prefix) => safeStorageList(db, prefix, storageLimit)),
  ]);
  const warnings = [...refWarnings, ...storageBlocks.map((block) => block.warning).filter(Boolean)] as string[];
  const graph = summarizeReferenceGraph(refs);
  const storageItems = storageBlocks.flatMap((block) => block.rows as Array<StorageItem & { prefix?: string }>);
  const classified = storageItems
    .filter((item) => item.name && item.name !== ".emptyFolderPlaceholder")
    .map((item) => classifyStorageItem(item, graph.byPath.get(`${item.prefix}/${item.name}`) || []));
  const storageByPath = new Map(classified.map((item) => [item.path, item]));
  const orphanCandidates = classified.filter((item) => item.status === "orphan_candidate");
  const protectedItems = classified.filter((item) => item.status === "protected");
  const reviewItems = classified.filter((item) => item.status === "referenced_review");
  const assetRows = ((await safeSelect(db, "content_assets", "id,url,path,kind,disk,analysis,created_at", limit)).rows || [])
    .filter((row) => String(row.disk || "") === "gen");
  const yandexArchivedReleaseCandidates = buildYandexArchivedReleaseCandidates(assetRows, storageByPath);

  return {
    ok: true,
    destructive: false,
    ready: warnings.length === 0,
    apply: false,
    generated_at: new Date().toISOString(),
    limits: { row_limit: limit, storage_limit_per_prefix: storageLimit, prefixes: STORAGE_PREFIXES },
    warnings,
    reference_graph: {
      total_references: refs.length,
      storage_references: Array.from(graph.byPath.values()).reduce((sum, rows) => sum + rows.length, 0),
      by_table: graph.byTable,
      unique_storage_paths: graph.byPath.size,
    },
    storage: {
      scanned: classified.length,
      protected: protectedItems.length,
      referenced_review: reviewItems.length,
      orphan_candidates: orphanCandidates.length,
      estimated_orphan_bytes: orphanCandidates.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0),
    },
    candidates: orphanCandidates.slice(0, 100),
    yandex_archived_release: {
      ready: yandexArchivedReleaseCandidates.length,
      estimated_bytes: yandexArchivedReleaseCandidates.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0),
      candidates: yandexArchivedReleaseCandidates,
    },
    referenced_review: reviewItems.slice(0, 60),
    protected_sample: protectedItems.slice(0, 40),
    next_steps: [
      "Review orphan_candidates before adding any delete endpoint.",
      "Archive generated videos, clips, and images to Yandex before cleanup.",
      "Use yandex_archived_release as the only safe source for a future storage release apply endpoint.",
      "Never delete protected_sample rows, DB rows, or unarchived storage files.",
    ],
  };
}

export async function releaseYandexArchivedFactoryStorage(db: DbClient | null | undefined, input?: {
  limit?: number;
  storageLimit?: number;
}) {
  const limit = Math.min(Math.max(Number(input?.limit || 25), 1), 100);
  const dryRun = await buildFactoryStorageCleanupDryRun(db, {
    limit: Math.max(limit, 50),
    storageLimit: input?.storageLimit || 5000,
  });
  const candidates = ((dryRun.yandex_archived_release?.candidates || []) as Array<{
    id?: string | number | null;
    storage_path?: string | null;
    yandex_archive_path?: string | null;
  }>)
    .filter((item) => item.storage_path && item.yandex_archive_path)
    .slice(0, limit);

  if (!db?.storage) {
    return {
      ok: false,
      destructive: true,
      apply: true,
      deleted: 0,
      failed: 0,
      error: "Supabase storage client is unavailable",
      items: [],
    };
  }

  const bucket = db.storage.from(BUCKET);
  if (typeof bucket.remove !== "function") {
    return {
      ok: false,
      destructive: true,
      apply: true,
      deleted: 0,
      failed: 0,
      error: "Supabase storage remove is unavailable",
      items: [],
    };
  }

  if (!candidates.length) {
    return {
      ok: true,
      destructive: true,
      apply: true,
      deleted: 0,
      failed: 0,
      candidates: 0,
      items: [],
    };
  }

  const { error } = await bucket.remove(candidates.map((item) => String(item.storage_path)));
  const failed = error ? candidates.length : 0;
  const deleted = error ? 0 : candidates.length;

  if (!error) {
    const releasedAt = new Date().toISOString();
    for (const item of candidates) {
      try {
        const { data } = await db.from("content_assets").select("analysis").eq("id", item.id).limit(1);
        const row = ((data as Record<string, unknown>[] | null) || [])[0] || {};
        const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Record<string, unknown> : {};
        await db.from("content_assets").update({
          analysis: {
            ...analysis,
            supabase_storage_released_at: releasedAt,
            supabase_storage_released_path: item.storage_path,
            supabase_storage_release_source: "factory_yandex_release_v1",
          },
        }).eq("id", item.id);
      } catch {
        // Storage was already released; metadata update is best-effort.
      }
    }
  }

  return {
    ok: !error,
    destructive: true,
    apply: true,
    deleted,
    failed,
    candidates: candidates.length,
    error: error ? safeError(error) : null,
    items: candidates.map((item) => ({
      id: item.id ?? null,
      storage_path: item.storage_path,
      yandex_archive_path: item.yandex_archive_path,
      status: error ? "failed" : "deleted",
      error: error ? safeError(error) : null,
    })),
  };
}
