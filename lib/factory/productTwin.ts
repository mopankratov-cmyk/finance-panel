import { createHash } from "node:crypto";

export type ProductTwinCategory = "cosmetics" | "toy" | "apparel" | "bag" | "other";
export type ProductTwinStatus = "building" | "ready" | "needs_review" | "failed";
export type ProductTwinAssetKind =
  | "original"
  | "clean_png"
  | "white_bg"
  | "gray_bg"
  | "shadow_bg"
  | "upscaled"
  | "object_mask"
  | "alpha"
  | "depth_map"
  | "segmentation"
  | "broll_source";
export type ProductTwinTruthLevel = "truthful" | "derived" | "synthetic";
export type ProductTwinUseCase = "hero" | "broll" | "ugc" | "marketplace" | "ads";

export interface ProductTwinAssetDraft {
  kind: ProductTwinAssetKind;
  url: string;
  path?: string;
  truthLevel: ProductTwinTruthLevel;
  qualityScore: number;
  heroReady?: boolean;
  brollReady?: boolean;
  ugcReady?: boolean;
  marketplaceSafe?: boolean;
  adsSafe?: boolean;
  risk?: "low" | "medium" | "high";
  sourceKind?: string;
  qualityDetails?: Record<string, unknown>;
}

export interface ProductTwinAsset extends ProductTwinAssetDraft {
  assetId: string;
  twinId: string;
  article: string;
}

export interface ProductPromptLibrary {
  preserve_identity: string;
  negative_identity: string;
  clean_source: string;
  broll_motion: string[];
  hero_shot: string[];
  marketplace_card: string[];
  ugc_scene: string[];
}

export interface ProductTwin {
  twinId: string;
  article: string;
  productName: string;
  category: ProductTwinCategory;
  status: ProductTwinStatus;
  qualityScore: number;
  canonicalAssetId: string;
  sourceKind: string;
  sourcePath?: string;
  promptLibrary: ProductPromptLibrary;
  assets: ProductTwinAsset[];
  createdAt: string;
}

export function normalizeTwinCategory(value: unknown, article = "", product = ""): ProductTwinCategory {
  const raw = String(value || "").trim().toLowerCase();
  if (["cosmetics", "cream", "skincare", "beauty"].includes(raw)) return "cosmetics";
  if (["toy", "toys", "blaster", "water_blaster"].includes(raw)) return "toy";
  if (["apparel", "clothing", "jacket"].includes(raw)) return "apparel";
  if (["bag", "bags"].includes(raw)) return "bag";
  const hay = `${article} ${product}`.toLowerCase();
  if (/yoyo|spf|cream|sunscreen|cosrx|bergamo|крем|spf/i.test(hay)) return "cosmetics";
  if (/tt04102|blaster|water|toy|узи|бластер/i.test(hay)) return "toy";
  if (/jacket|куртк|ветровк|apparel/i.test(hay)) return "apparel";
  if (/bag|сумк/i.test(hay)) return "bag";
  return "other";
}

export function buildTwinId(input: { article: string; source: string; version?: string }): string {
  const hash = createHash("sha1").update(`${input.article}:${input.source}:${input.version || "v0"}`).digest("hex").slice(0, 12);
  return `pt_${input.article.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}_${hash}`;
}

export function buildTwinAssetId(twinId: string, kind: ProductTwinAssetKind): string {
  return `${twinId}_${kind}`;
}

export function buildProductPromptLibrary(input: { article: string; product: string; category: ProductTwinCategory; cleanPrompt: string }): ProductPromptLibrary {
  const identity = `Preserve the exact product identity for ${input.article}: ${input.product}. Keep the same silhouette, packaging proportions, label placement, cap/nozzle/trigger details, material finish, and real product colors.`;
  const negative = "changed shape, invented logo, altered label, warped text, extra objects, extra products, deformed packaging, melted edges, low quality, blurry, AI-looking artifact";
  if (input.category === "toy") {
    return {
      preserve_identity: identity,
      negative_identity: negative,
      clean_source: input.cleanPrompt,
      broll_motion: ["water burst hook", "backyard hero", "hand grab", "splash table", "pool edge", "feature detail"],
      hero_shot: ["clean summer product hero", "bright studio toy packshot"],
      marketplace_card: ["white background product card", "shadow background product card"],
      ugc_scene: ["parent hand picks up toy", "summer play setup"],
    };
  }
  if (input.category === "cosmetics") {
    return {
      preserve_identity: identity,
      negative_identity: negative,
      clean_source: input.cleanPrompt,
      broll_motion: ["macro texture hook", "hand pickup", "vanity orbit", "cap detail", "morning light", "shelf hero"],
      hero_shot: ["premium skincare product hero", "clean bathroom shelf packshot"],
      marketplace_card: ["white background cosmetics card", "soft studio cosmetics card"],
      ugc_scene: ["morning routine pickup", "bathroom vanity product moment"],
    };
  }
  return {
    preserve_identity: identity,
    negative_identity: negative,
    clean_source: input.cleanPrompt,
    broll_motion: ["slow push in", "hand pickup", "detail closeup", "table hero"],
    hero_shot: ["clean product hero"],
    marketplace_card: ["white background product card"],
    ugc_scene: ["product in hand"],
  };
}

export function createTwinAsset(input: ProductTwinAssetDraft & { twinId: string; article: string }): ProductTwinAsset {
  return {
    ...input,
    assetId: buildTwinAssetId(input.twinId, input.kind),
    twinId: input.twinId,
    article: input.article,
    risk: input.risk || "low",
    heroReady: input.heroReady ?? (input.kind === "shadow_bg" || input.kind === "white_bg"),
    brollReady: input.brollReady ?? (input.kind === "broll_source" || input.kind === "clean_png" || input.kind === "shadow_bg"),
    ugcReady: input.ugcReady ?? (input.kind === "broll_source" || input.kind === "shadow_bg"),
    marketplaceSafe: input.marketplaceSafe ?? input.truthLevel !== "synthetic",
    adsSafe: input.adsSafe ?? true,
  };
}

export function pickBestTwinAsset(assets: ProductTwinAsset[], useCase: ProductTwinUseCase): ProductTwinAsset | null {
  const flag = useCase === "broll" ? "brollReady"
    : useCase === "hero" ? "heroReady"
    : useCase === "ugc" ? "ugcReady"
    : useCase === "marketplace" ? "marketplaceSafe"
    : "adsSafe";
  const candidates = assets.filter((a) => Boolean(a[flag]));
  const serviceKinds = new Set<ProductTwinAssetKind>(["object_mask", "alpha", "depth_map", "segmentation"]);
  const fallbackPriority: ProductTwinAssetKind[] = useCase === "broll"
    ? ["shadow_bg", "clean_png", "upscaled", "white_bg", "gray_bg", "broll_source", "original"]
    : useCase === "hero"
      ? ["shadow_bg", "white_bg", "clean_png", "upscaled", "gray_bg", "original"]
      : ["clean_png", "shadow_bg", "upscaled", "white_bg", "gray_bg", "original"];
  const pool = candidates.length ? candidates : assets.filter((a) => !serviceKinds.has(a.kind));
  const priority = (kind: ProductTwinAssetKind) => {
    const index = fallbackPriority.indexOf(kind);
    return index === -1 ? 999 : index;
  };
  pool.sort((a, b) => {
    const riskScore = (v: ProductTwinAsset) => v.risk === "low" ? 0 : v.risk === "medium" ? 1 : 2;
    return priority(a.kind) - priority(b.kind) || riskScore(a) - riskScore(b) || b.qualityScore - a.qualityScore;
  });
  return pool[0] || null;
}
