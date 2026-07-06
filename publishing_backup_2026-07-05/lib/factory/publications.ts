import { normalizeDistributionPlatform } from "./distribution";

type DbClient = {
  from: (table: string) => any;
};

type PublicationStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
type PublicationMode = "organic" | "paid" | "manual";

type PublicationInput = {
  recipeId: number;
  ugcJobId?: string | null;
  targetId?: string | null;
  sourceUrl?: string | null;
  platform?: string | null;
  mode?: PublicationMode | string | null;
  status?: PublicationStatus | string | null;
  publishedUrl?: string | null;
  externalPostId?: string | null;
  adTokenPresent?: boolean;
  scheduledAt?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PublicationRecordResult = {
  id: string | null;
  status: PublicationStatus | null;
  warning: string | null;
};

const STATUSES = new Set<PublicationStatus>(["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);
const MODES = new Set<PublicationMode>(["organic", "paid", "manual"]);

function cleanText(value: unknown, max = 500): string | null {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

function normalizePlatform(value: unknown): string {
  return normalizeDistributionPlatform(value);
}

function normalizeStatus(value: unknown): PublicationStatus {
  const raw = String(value || "draft").trim().toLowerCase() as PublicationStatus;
  return STATUSES.has(raw) ? raw : "draft";
}

function normalizeMode(value: unknown): PublicationMode {
  const raw = String(value || "organic").trim().toLowerCase() as PublicationMode;
  return MODES.has(raw) ? raw : "organic";
}

function safeError(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message || error || "unknown");
  return message.slice(0, 180);
}

function isMissingOptionalPublicationTable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const text = `${String(e?.code || "")} ${String(e?.message || "")} ${String(e?.details || "")}`.toLowerCase();
  return text.includes("factory_publications")
    && (text.includes("schema cache") || text.includes("does not exist") || text.includes("pgrst205") || text.includes("42p01"));
}

function nextMetricsPullAtIso(now = Date.now()): string {
  return new Date(now + 60 * 60 * 1000).toISOString();
}

async function updateRecipePublicationPointer(
  db: DbClient,
  recipeId: number,
  publicationId: string,
  status: PublicationStatus,
  publishedUrl: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    latest_publication_id: publicationId,
    distribution_status: status,
    updated_at: new Date().toISOString(),
  };
  if (publishedUrl) patch.published_url = publishedUrl;
  try {
    await db.from("node_recipes").update(patch).eq("id", recipeId);
  } catch {
    // node_recipes migration columns are optional in older DBs.
  }
}

export async function recordFactoryPublication(db: DbClient | null | undefined, input: PublicationInput): Promise<PublicationRecordResult> {
  if (!db || !input.recipeId) return { id: null, status: null, warning: "publication skipped: db/recipe missing" };

  const recipeId = Math.floor(Number(input.recipeId) || 0);
  const sourceUrl = cleanText(input.sourceUrl, 1200);
  const ugcJobId = cleanText(input.ugcJobId, 120);
  const targetId = cleanText(input.targetId, 120);
  const platform = normalizePlatform(input.platform);
  const status = normalizeStatus(input.status);
  const mode = normalizeMode(input.mode);
  const publishedUrl = cleanText(input.publishedUrl, 1200);
  const externalPostId = cleanText(input.externalPostId, 240);
  const scheduledAt = cleanText(input.scheduledAt, 80);
  const errorText = cleanText(input.error, 500);
  const metadata = { ...(input.metadata || {}) };
  const now = new Date().toISOString();

  if (!recipeId) return { id: null, status: null, warning: "publication skipped: recipe_id missing" };
  if (!sourceUrl && !publishedUrl && !externalPostId) return { id: null, status: null, warning: "publication skipped: no artifact" };

  try {
    let existing: {
      id?: string;
      metadata?: Record<string, unknown> | null;
      last_metrics_pull_at?: string | null;
      next_metrics_pull_at?: string | null;
      published_at?: string | null;
    } | null = null;
    let q = db.from("factory_publications")
      .select("id,metadata,last_metrics_pull_at,next_metrics_pull_at,published_at")
      .eq("recipe_id", recipeId)
      .eq("platform", platform)
      .order("created_at", { ascending: false })
      .limit(1);
    if (sourceUrl) q = q.eq("source_url", sourceUrl);
    else if (externalPostId) q = q.eq("external_post_id", externalPostId);
    const found = await q;
    if (found?.error && isMissingOptionalPublicationTable(found.error)) return { id: null, status, warning: null };
    if (!found?.error) {
      existing = (found.data as Array<{
        id?: string;
        metadata?: Record<string, unknown> | null;
        last_metrics_pull_at?: string | null;
        next_metrics_pull_at?: string | null;
        published_at?: string | null;
      }> | null)?.[0] || null;
    }

    const row = {
      recipe_id: recipeId,
      ugc_job_id: ugcJobId,
      target_id: targetId,
      platform,
      mode,
      status,
      source_url: sourceUrl,
      published_url: publishedUrl,
      external_post_id: externalPostId,
      ad_token_present: input.adTokenPresent === true,
      scheduled_at: scheduledAt,
      error: errorText,
      metadata: { ...(existing?.metadata || {}), ...metadata },
      updated_at: now,
      ...(status === "published"
        ? {
          published_at: existing?.published_at || now,
          last_metrics_pull_at: existing?.last_metrics_pull_at || null,
          next_metrics_pull_at: existing?.next_metrics_pull_at || nextMetricsPullAtIso(),
        }
        : {}),
    };

    let id = existing?.id || null;
    if (id) {
      const updated = await db.from("factory_publications").update(row).eq("id", id).select("id").limit(1);
      if (updated?.error && isMissingOptionalPublicationTable(updated.error)) return { id: null, status, warning: null };
      if (updated?.error) return { id: null, status, warning: `factory_publications update: ${safeError(updated.error)}` };
      id = (updated.data as { id?: string }[] | null)?.[0]?.id || id;
    } else {
      const inserted = await db.from("factory_publications").insert({ ...row, created_at: now }).select("id").limit(1);
      if (inserted?.error && isMissingOptionalPublicationTable(inserted.error)) return { id: null, status, warning: null };
      if (inserted?.error) return { id: null, status, warning: `factory_publications insert: ${safeError(inserted.error)}` };
      id = (inserted.data as { id?: string }[] | null)?.[0]?.id || null;
    }

    if (id) await updateRecipePublicationPointer(db, recipeId, id, status, publishedUrl);
    return { id, status, warning: id ? null : "factory_publications missing returned id" };
  } catch (error) {
    return { id: null, status, warning: `factory_publications exception: ${safeError(error)}` };
  }
}
