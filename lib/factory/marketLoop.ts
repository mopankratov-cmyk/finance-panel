import { internalFetch } from "@/lib/internalFetch";
import { getChannelAdapter, toPublishTarget } from "./publishAdapters";
import type { MetricSnapshot, PublishTarget } from "./publishAdapters/types";

type DbClient = {
  from: (table: string) => any;
};

type JsonRecord = Record<string, unknown>;

type PublicationContext = {
  publicationId: string;
  recipeId: number;
  platform: string;
  externalPostId: string | null;
  publishedUrl: string | null;
  targetId: string | null;
  target: PublishTarget | null;
  metadata: JsonRecord;
};

type SaveMetricsInput = {
  recipeId: number;
  platform: string;
  publicationId?: string | null;
  externalPostId?: string | null;
  postedAt?: string | null;
  views: number;
  watchRate?: number | null;
  completionRate?: number | null;
  ctrCard?: number | null;
  saves?: number | null;
  engagementCount?: number | null;
  marketplaceOrders?: number | null;
  revenue?: number | null;
  source?: string | null;
  rawMetrics?: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, max = 500): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedPlatform(value: unknown): string {
  return (text(value, 80) || "unknown").toLowerCase();
}

function safeError(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error || "unknown").slice(0, 220);
}

async function maybeSingle(query: Promise<{ data?: unknown; error?: { message?: string } | null }>) {
  const res = await query;
  if (res?.error) throw new Error(res.error.message || "db query failed");
  return (res?.data || null) as JsonRecord | null;
}

export async function findPublicationContext(db: DbClient, input: {
  publicationId?: unknown;
  recipeId?: unknown;
  externalPostId?: unknown;
}): Promise<PublicationContext | null> {
  const publicationId = text(input.publicationId, 120);
  const externalPostId = text(input.externalPostId, 240);
  const recipeId = Math.floor(Number(input.recipeId) || 0);

  let query = db.from("factory_publications")
    .select("id,recipe_id,platform,external_post_id,published_url,target_id,metadata,published_at,created_at")
    .limit(1);

  if (publicationId) query = query.eq("id", publicationId);
  else if (externalPostId) query = query.eq("external_post_id", externalPostId);
  else if (recipeId > 0) query = query.eq("recipe_id", recipeId).order("published_at", { ascending: false }).order("created_at", { ascending: false });
  else return null;

  const publication = await maybeSingle(query.maybeSingle ? query.maybeSingle() : query);
  if (!publication) return null;

  const targetId = text(publication.target_id, 120);
  let target: PublishTarget | null = null;
  if (targetId) {
    try {
      const targetRow = await maybeSingle(
        db.from("factory_distribution_targets")
          .select("id,platform,account_ref,mode,config")
          .eq("id", targetId)
          .limit(1)
          .maybeSingle()
      );
      if (targetRow) target = toPublishTarget(targetRow);
    } catch {
      target = null;
    }
  }

  return {
    publicationId: text(publication.id, 120) || "",
    recipeId: Math.floor(Number(publication.recipe_id) || 0),
    platform: normalizedPlatform(publication.platform),
    externalPostId: text(publication.external_post_id, 240),
    publishedUrl: text(publication.published_url, 1200),
    targetId,
    target,
    metadata: asRecord(publication.metadata),
  };
}

export async function pullLiveMetrics(db: DbClient, input: {
  publicationId?: unknown;
  recipeId?: unknown;
  externalPostId?: unknown;
}) {
  const context = await findPublicationContext(db, input);
  if (!context) return { ok: false as const, error: "publication context not found", context: null, metrics: null };
  if (!context.externalPostId) return { ok: false as const, error: "external_post_id is missing", context, metrics: null };
  if (!context.target) return { ok: false as const, error: "distribution target is missing", context, metrics: null };

  const adapter = getChannelAdapter(context.platform);
  if (!adapter) return { ok: false as const, error: `adapter for ${context.platform} is not configured`, context, metrics: null };

  try {
    const metrics = await adapter.pullMetrics(context.externalPostId, context.target);
    if (!metrics) return { ok: false as const, error: `adapter returned no metrics for ${context.platform}`, context, metrics: null };
    return { ok: true as const, error: null, context, metrics };
  } catch (error) {
    return { ok: false as const, error: safeError(error), context, metrics: null };
  }
}

export async function savePostMetrics(db: DbClient, input: SaveMetricsInput) {
  const baseRow: JsonRecord = {
    recipe_id: input.recipeId,
    platform: normalizedPlatform(input.platform).slice(0, 20),
    posted_at: input.postedAt || new Date().toISOString(),
    views: Math.max(0, Math.floor(Number(input.views) || 0)),
    watch_rate: num(input.watchRate),
    completion_rate: num(input.completionRate),
    ctr_card: num(input.ctrCard),
    saves: num(input.saves),
    engagement_count: num(input.engagementCount),
    marketplace_orders: num(input.marketplaceOrders),
    revenue: num(input.revenue),
    source: text(input.source, 80),
    raw_metrics: input.rawMetrics ?? null,
  };

  const attempts: JsonRecord[] = [
    {
      ...baseRow,
      publication_id: text(input.publicationId, 120),
      external_post_id: text(input.externalPostId, 240),
    },
    {
      ...baseRow,
      external_post_id: text(input.externalPostId, 240),
    },
    {
      recipe_id: baseRow.recipe_id,
      platform: baseRow.platform,
      posted_at: baseRow.posted_at,
      views: baseRow.views,
      watch_rate: baseRow.watch_rate,
      ctr_card: baseRow.ctr_card,
      saves: baseRow.saves,
    },
  ];

  let lastError: string | null = null;
  for (const row of attempts) {
    try {
      const { error } = await db.from("post_metrics").insert(row);
      if (!error) return { ok: true as const, mode: Object.keys(row).join(","), error: null };
      lastError = error.message || "post_metrics insert failed";
    } catch (error) {
      lastError = safeError(error);
    }
  }

  return { ok: false as const, mode: null, error: lastError || "post_metrics insert failed" };
}

export async function forwardWinnerFromRecipe(origin: string, db: DbClient, input: {
  recipeId: number;
  platform?: unknown;
  views: number;
  note?: unknown;
}) {
  const recipe = await maybeSingle(
    db.from("node_recipes")
      .select("output_url,run_plan")
      .eq("id", input.recipeId)
      .limit(1)
      .maybeSingle()
  );
  const url = text(recipe?.output_url, 1200);
  if (!url) return { ok: false as const, forwarded: false, error: "recipe output_url not found" };

  const nodes = (Array.isArray(recipe?.run_plan && asRecord(recipe.run_plan).nodes)
    ? (asRecord(recipe!.run_plan).nodes as JsonRecord[])
    : []) as JsonRecord[];
  const hookNode = nodes.find((n) => String(asRecord(n.params).role || n.slot || "").toLowerCase() === "hook") || nodes[0] || {};
  const hook = String(hookNode.onscreen_text || hookNode.prompt || "").slice(0, 120);

  try {
    const res = await internalFetch(`${origin}/api/factory/winners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        hook,
        views: Math.max(0, Math.floor(Number(input.views) || 0)),
        recipe_id: input.recipeId,
        note: text(input.note, 200) || `рынок: ${input.views} просм · ${text(input.platform, 20) || "unknown"}`,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return {
        ok: false as const,
        forwarded: false,
        error: text(json?.error, 220) || `winners ${res.status}`,
        payload: json,
      };
    }
    return { ok: true as const, forwarded: true, error: null, payload: json };
  } catch (error) {
    return { ok: false as const, forwarded: false, error: safeError(error), payload: null };
  }
}

export function metricSnapshotToRow(snapshot: MetricSnapshot) {
  return {
    views: Math.max(0, Math.floor(Number(snapshot.views) || 0)),
    watchRate: num(snapshot.watch_rate),
    completionRate: num(snapshot.completion_rate),
    saves: num(snapshot.saves),
    engagementCount: num(snapshot.engagement_count),
    marketplaceOrders: num(snapshot.marketplace_orders),
    revenue: num(snapshot.revenue),
    rawMetrics: snapshot.raw ?? null,
  };
}
