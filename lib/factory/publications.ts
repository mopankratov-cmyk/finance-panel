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
  const raw = String(value || "tiktok").trim().toLowerCase();
  if (raw.includes("inst") || raw.includes("reels")) return "instagram";
  if (raw.includes("youtube") || raw.includes("short")) return "youtube";
  if (raw.includes("telegram") || raw === "tg") return "telegram";
  if (raw.includes("vk")) return "vk";
  if (raw.includes("pin")) return "pinterest";
  if (raw.includes("manual")) return "manual";
  return "tiktok";
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
    let existing: { id?: string; metadata?: Record<string, unknown> | null } | null = null;
    let q = db.from("factory_publications")
      .select("id,metadata")
      .eq("recipe_id", recipeId)
      .eq("platform", platform)
      .order("created_at", { ascending: false })
      .limit(1);
    if (sourceUrl) q = q.eq("source_url", sourceUrl);
    else if (externalPostId) q = q.eq("external_post_id", externalPostId);
    const found = await q;
    if (!found?.error) existing = (found.data as { id?: string; metadata?: Record<string, unknown> | null }[] | null)?.[0] || null;

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
      ...(status === "published" ? { published_at: now, last_metrics_pull_at: now } : {}),
    };

    let id = existing?.id || null;
    if (id) {
      const updated = await db.from("factory_publications").update(row).eq("id", id).select("id").limit(1);
      if (updated?.error) return { id: null, status, warning: `factory_publications update: ${safeError(updated.error)}` };
      id = (updated.data as { id?: string }[] | null)?.[0]?.id || id;
    } else {
      const inserted = await db.from("factory_publications").insert({ ...row, created_at: now }).select("id").limit(1);
      if (inserted?.error) return { id: null, status, warning: `factory_publications insert: ${safeError(inserted.error)}` };
      id = (inserted.data as { id?: string }[] | null)?.[0]?.id || null;
    }

    if (id) await updateRecipePublicationPointer(db, recipeId, id, status, publishedUrl);
    return { id, status, warning: id ? null : "factory_publications missing returned id" };
  } catch (error) {
    return { id: null, status, warning: `factory_publications exception: ${safeError(error)}` };
  }
}
