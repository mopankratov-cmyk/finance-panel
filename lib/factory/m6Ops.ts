type DbClient = {
  from: (table: string) => any;
};

type StatusCounts = Record<string, number>;

function countBy<T extends Record<string, unknown>>(rows: T[], key: string): StatusCounts {
  return rows.reduce<StatusCounts>((acc, row) => {
    const value = String(row[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function safeError(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message || error || "unknown");
  return message.slice(0, 180);
}

async function safeSelect(db: DbClient, table: string, select: string, limit = 80): Promise<{ rows: Record<string, unknown>[]; warning: string | null }> {
  try {
    const res = await db.from(table).select(select).order("created_at", { ascending: false }).limit(limit);
    if (res?.error) return { rows: [], warning: `${table}: ${safeError(res.error)}` };
    return { rows: (res?.data as Record<string, unknown>[] | null) || [], warning: null };
  } catch (error) {
    return { rows: [], warning: `${table}: ${safeError(error)}` };
  }
}

export async function loadM6OpsSnapshot(db: DbClient | null | undefined) {
  if (!db) {
    return {
      ok: true,
      ready: false,
      publications: { total_sample: 0, by_status: {}, latest: [] },
      ugc_jobs: { total_sample: 0, by_status: {}, by_dlq_category: {}, latest: [] },
      warnings: ["Supabase is not configured"],
    };
  }

  const [publicationsResult, ugcJobsResult] = await Promise.all([
    safeSelect(db, "factory_publications", "id,recipe_id,platform,mode,status,source_url,published_url,external_post_id,error,created_at,updated_at", 80),
    safeSelect(db, "factory_ugc_jobs", "id,recipe_id,provider,provider_job_id,status,dlq_category,output_url,error,created_at,updated_at", 80),
  ]);

  const warnings = [publicationsResult.warning, ugcJobsResult.warning].filter(Boolean) as string[];
  return {
    ok: true,
    ready: warnings.length === 0,
    publications: {
      total_sample: publicationsResult.rows.length,
      by_status: countBy(publicationsResult.rows, "status"),
      by_platform: countBy(publicationsResult.rows, "platform"),
      latest: publicationsResult.rows.slice(0, 10),
    },
    ugc_jobs: {
      total_sample: ugcJobsResult.rows.length,
      by_status: countBy(ugcJobsResult.rows, "status"),
      by_dlq_category: countBy(ugcJobsResult.rows.filter((row) => row.dlq_category), "dlq_category"),
      latest: ugcJobsResult.rows.slice(0, 10),
    },
    warnings,
  };
}
