export type DistributionMode = "organic" | "paid" | "manual";
export type DistributionStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";

export interface PublicationPlanInput {
  recipeId: unknown;
  sourceUrl?: unknown;
  publishedUrl?: unknown;
  externalPostId?: unknown;
  platform?: unknown;
  mode?: unknown;
  status?: unknown;
  adToken?: unknown;
  scheduledAt?: unknown;
}

export interface PublicationPlan {
  ok: boolean;
  statusCode: number;
  error: string | null;
  recipeId: number;
  platform: string;
  mode: DistributionMode;
  status: DistributionStatus;
  sourceUrl: string | null;
  publishedUrl: string | null;
  externalPostId: string | null;
  adTokenPresent: boolean;
  scheduledAt: string | null;
  metricsPollable: boolean;
  warnings: string[];
}

const MODES = new Set<DistributionMode>(["organic", "paid", "manual"]);
const STATUSES = new Set<DistributionStatus>(["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);

function clean(value: unknown, max = 1000): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeDistributionPlatform(value: unknown): string {
  const raw = String(value || "tiktok").trim().toLowerCase();
  if (raw.includes("wibes")) return "wibes";
  if (raw.includes("vk_clips") || raw.includes("vk clips") || raw.includes("vkclips")) return "vk_clips";
  if (raw.includes("inst") || raw.includes("reels")) return "instagram";
  if (raw.includes("youtube") || raw.includes("short")) return "youtube";
  if (raw.includes("telegram") || raw === "tg") return "telegram";
  if (raw.includes("vk")) return "vk";
  if (raw.includes("pin")) return "pinterest";
  if (raw.includes("manual")) return "manual";
  return "tiktok";
}

function normalizeMode(value: unknown): DistributionMode {
  const mode = String(value || "organic").trim().toLowerCase() as DistributionMode;
  return MODES.has(mode) ? mode : "organic";
}

function normalizeStatus(value: unknown, input: { publishedUrl: string | null; externalPostId: string | null; scheduledAt: string | null }): DistributionStatus {
  const explicit = String(value || "").trim().toLowerCase() as DistributionStatus;
  if (STATUSES.has(explicit)) return explicit;
  if (input.publishedUrl || input.externalPostId) return "published";
  if (input.scheduledAt) return "scheduled";
  return "draft";
}

export function buildPublicationPlan(input: PublicationPlanInput): PublicationPlan {
  const recipeId = Math.floor(Number(input.recipeId) || 0);
  const sourceUrl = clean(input.sourceUrl, 1200);
  const publishedUrl = clean(input.publishedUrl, 1200);
  const externalPostId = clean(input.externalPostId, 240);
  const scheduledAt = clean(input.scheduledAt, 80);
  const platform = normalizeDistributionPlatform(input.platform);
  const mode = normalizeMode(input.mode);
  const adToken = clean(input.adToken, 240);
  const adTokenPresent = !!adToken;
  const status = normalizeStatus(input.status, { publishedUrl, externalPostId, scheduledAt });
  const warnings: string[] = [];

  if (!recipeId) {
    return { ok: false, statusCode: 400, error: "recipe_id is required", recipeId, platform, mode, status, sourceUrl, publishedUrl, externalPostId, adTokenPresent, scheduledAt, metricsPollable: false, warnings };
  }
  if (!sourceUrl && !publishedUrl && !externalPostId) {
    return { ok: false, statusCode: 400, error: "source_url or published_url is required", recipeId, platform, mode, status, sourceUrl, publishedUrl, externalPostId, adTokenPresent, scheduledAt, metricsPollable: false, warnings };
  }
  if (mode === "paid" && !adTokenPresent) {
    return { ok: false, statusCode: 402, error: "paid publication requires ad_token", recipeId, platform, mode, status, sourceUrl, publishedUrl, externalPostId, adTokenPresent, scheduledAt, metricsPollable: false, warnings };
  }
  if (mode === "paid" && platform === "manual") warnings.push("paid publication targets manual platform");

  return {
    ok: true,
    statusCode: 200,
    error: null,
    recipeId,
    platform,
    mode,
    status,
    sourceUrl,
    publishedUrl,
    externalPostId,
    adTokenPresent,
    scheduledAt,
    metricsPollable: status === "published" || status === "scheduled",
    warnings,
  };
}
