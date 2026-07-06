import { getChannelAdapter, toPublishTarget } from "./publishAdapters";
import type { PublishMedia, PublishMeta, PublishTarget } from "./publishAdapters/types";

type DbClient = {
  from: (table: string) => any;
};

type JsonRecord = Record<string, unknown>;

type PublishRequest = {
  recipeId: unknown;
  article?: unknown;
  videoPathOrUrl?: unknown;
  coverPath?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  articles?: unknown;
  adToken?: unknown;
  targetId?: unknown;
  target?: unknown;
  sourceUrl?: unknown;
  metadata?: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as JsonRecord) } : {};
}

function text(value: unknown, max = 1200): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function list(value: unknown, maxItems = 12, maxItemLen = 120): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems) as string[];
}

function safeError(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error || "unknown").slice(0, 220);
}

async function maybeSingle(query: Promise<{ data?: unknown; error?: { message?: string } | null }>) {
  const res = await query;
  if (res?.error) throw new Error(res.error.message || "db query failed");
  return (res?.data || null) as JsonRecord | null;
}

export async function resolvePublishTarget(db: DbClient | null, input: {
  targetId?: unknown;
  target?: unknown;
}): Promise<{ target: PublishTarget | null; warning: string | null }> {
  const inlineTarget = input.target ? toPublishTarget(input.target) : null;
  const inlineTargetOk = inlineTarget && inlineTarget.platform && inlineTarget.account_ref;
  if (inlineTargetOk) return { target: inlineTarget, warning: null };

  const targetId = text(input.targetId, 120);
  if (!targetId) return { target: inlineTarget, warning: inlineTarget ? "inline target is incomplete" : "target_id or target is required" };
  if (!db) return { target: null, warning: "Supabase read client is not configured" };

  try {
    const row = await maybeSingle(
      db.from("factory_distribution_targets")
        .select("id,platform,account_ref,mode,config")
        .eq("id", targetId)
        .limit(1)
        .maybeSingle()
    );
    if (!row) return { target: null, warning: `distribution target ${targetId} not found` };
    return { target: toPublishTarget(row), warning: null };
  } catch (error) {
    return { target: null, warning: safeError(error) };
  }
}

export function buildPublishPayload(input: PublishRequest) {
  const recipeId = Math.floor(Number(input.recipeId) || 0);
  const media: PublishMedia = {
    recipe_id: recipeId,
    article: text(input.article, 120),
    video_path_or_url: text(input.videoPathOrUrl, 1200) || "",
    cover_path: text(input.coverPath, 1200) || undefined,
  };
  const meta: PublishMeta = {
    caption: text(input.caption, 500) || "",
    hashtags: list(input.hashtags, 20, 80),
    articles: list(input.articles, 8, 80),
    ad_token: text(input.adToken, 240),
  };
  const warnings: string[] = [];
  if (!recipeId) warnings.push("recipe_id is required");
  if (!media.video_path_or_url) warnings.push("video_path_or_url is required");
  return { recipeId, media, meta, warnings };
}

export async function persistPublication(db: DbClient | null, input: {
  recipeId: number;
  target: PublishTarget;
  sourceUrl: string | null;
  publishedUrl: string;
  externalPostId: string;
  metadata?: unknown;
}) {
  if (!db) {
    return { ok: false as const, persisted: false, warning: "write-path недоступен: нужен SUPABASE_SERVICE_ROLE_KEY", publicationId: null };
  }

  const payload = {
    recipe_id: input.recipeId,
    target_id: input.target.target_id || null,
    platform: text(input.target.platform, 80),
    mode: text(input.target.mode, 40) || "organic",
    status: "published",
    source_url: input.sourceUrl,
    published_url: input.publishedUrl,
    external_post_id: input.externalPostId,
    published_at: new Date().toISOString(),
    metadata: asRecord(input.metadata),
  };

  try {
    const res = await db.from("factory_publications").insert(payload).select("id").limit(1);
    const error = res?.error;
    if (error) return { ok: false as const, persisted: false, warning: safeError(error), publicationId: null };
    const row = Array.isArray(res?.data) ? res.data[0] : null;
    return { ok: true as const, persisted: true, warning: null, publicationId: text((row as JsonRecord | null)?.id, 120) };
  } catch (error) {
    return { ok: false as const, persisted: false, warning: safeError(error), publicationId: null };
  }
}

export async function runPublishNow(input: {
  readDb: DbClient | null;
  writeDb: DbClient | null;
  body: PublishRequest;
}) {
  const warnings: string[] = [];
  const { recipeId, media, meta, warnings: validationWarnings } = buildPublishPayload(input.body);
  warnings.push(...validationWarnings);
  if (validationWarnings.length) {
    return { ok: false as const, status: 400, error: validationWarnings[0], warnings, adapter: null, target: null };
  }

  const resolved = await resolvePublishTarget(input.readDb, {
    targetId: input.body.targetId,
    target: input.body.target,
  });
  if (resolved.warning) warnings.push(resolved.warning);
  if (!resolved.target) {
    return { ok: false as const, status: 400, error: "publish target is not resolved", warnings, adapter: null, target: null };
  }

  const adapter = getChannelAdapter(resolved.target.platform);
  if (!adapter) {
    warnings.push(`adapter for ${resolved.target.platform} is not configured`);
    return { ok: false as const, status: 400, error: `adapter for ${resolved.target.platform} is not configured`, warnings, adapter: null, target: resolved.target };
  }

  const auth = await adapter.authSession(resolved.target).catch((error) => {
    warnings.push(`authSession: ${safeError(error)}`);
    return "CAPTCHA" as const;
  });
  if (auth !== "OK") {
    const error =
      auth === "NEEDS_MANUAL_LOGIN"
        ? "channel auth requires manual login"
        : "channel auth check failed";
    warnings.push(error);
    return { ok: false as const, status: 409, error, warnings, adapter, target: resolved.target, auth };
  }

  const published = await adapter.publish(media, meta, resolved.target);
  if (!published.ok) {
    warnings.push(`${published.failure}: ${published.detail}`);
    return {
      ok: false as const,
      status: published.failure === "rate_limited" ? 429 : 502,
      error: published.detail,
      warnings,
      adapter,
      target: resolved.target,
      auth,
      published,
    };
  }

  const persisted = await persistPublication(input.writeDb, {
    recipeId,
    target: resolved.target,
    sourceUrl: text(input.body.sourceUrl || media.video_path_or_url, 1200),
    publishedUrl: published.published_url,
    externalPostId: published.external_post_id,
    metadata: {
      ...(asRecord(input.body.metadata)),
      target_id: resolved.target.target_id || null,
      target_platform: resolved.target.platform,
      target_account_ref: resolved.target.account_ref,
      target_mode: resolved.target.mode,
      publish_transport: adapter.transport,
      publish_capabilities: adapter.capabilities,
    },
  });
  if (persisted.warning) warnings.push(persisted.warning);

  return {
    ok: true as const,
    status: 200,
    error: null,
    warnings,
    adapter,
    target: resolved.target,
    auth,
    published,
    persisted,
  };
}
