import { pickBestTwinAsset, type ProductTwin, type ProductTwinAsset, type ProductTwinUseCase } from "./productTwin";

export type ProductTwinAssetType =
  | "clean_object"
  | "packshot"
  | "studio_shadow"
  | "upscaled_detail"
  | "mask"
  | "broll_source"
  | "other";

export interface ProductTwinAssetClassification {
  assetId: string;
  kind: ProductTwinAsset["kind"];
  type: ProductTwinAssetType;
  quality: "excellent" | "good" | "review" | "reject";
  qualityScore: number;
  risk: ProductTwinAsset["risk"];
  dominantColor: string | null;
  objectSize: "small" | "medium" | "large" | "unknown";
  hasPackaging: boolean;
  hasHands: boolean;
  suitableFor: Record<ProductTwinUseCase, boolean>;
  rejectReasons: string[];
}

export interface ProductTwinClassification {
  twinId: string;
  article: string;
  category: ProductTwin["category"];
  status: "ready" | "needs_review";
  canonical: Record<ProductTwinUseCase, string | null>;
  assets: ProductTwinAssetClassification[];
  summary: {
    totalAssets: number;
    readyAssets: number;
    reviewAssets: number;
    bestQualityScore: number;
    heroReady: boolean;
    brollReady: boolean;
    ugcReady: boolean;
    marketplaceReady: boolean;
    adsReady: boolean;
  };
}

function classifyKind(asset: ProductTwinAsset): ProductTwinAssetType {
  if (asset.kind === "clean_png") return "clean_object";
  if (asset.kind === "white_bg" || asset.kind === "gray_bg") return "packshot";
  if (asset.kind === "shadow_bg") return "studio_shadow";
  if (asset.kind === "upscaled") return "upscaled_detail";
  if (asset.kind === "object_mask" || asset.kind === "alpha" || asset.kind === "segmentation") return "mask";
  if (asset.kind === "broll_source") return "broll_source";
  return "other";
}

function classifyQuality(asset: ProductTwinAsset): ProductTwinAssetClassification["quality"] {
  if (asset.risk === "high" || asset.qualityScore < 0.55) return "reject";
  if (asset.risk === "medium" || asset.qualityScore < 0.72) return "review";
  if (asset.qualityScore >= 0.9) return "excellent";
  return "good";
}

function stringDetail(asset: ProductTwinAsset, keys: string[]): string {
  const details = asset.qualityDetails || {};
  for (const key of keys) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberDetail(asset: ProductTwinAsset, keys: string[]): number | null {
  const details = asset.qualityDetails || {};
  for (const key of keys) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function objectSize(asset: ProductTwinAsset): ProductTwinAssetClassification["objectSize"] {
  const coverage = numberDetail(asset, ["object_coverage", "objectCoverage", "alpha_coverage", "alphaCoverage"]);
  if (coverage == null) return "unknown";
  if (coverage < 0.22) return "small";
  if (coverage > 0.72) return "large";
  return "medium";
}

function rejectReasons(asset: ProductTwinAsset, quality: ProductTwinAssetClassification["quality"]): string[] {
  const details = asset.qualityDetails || {};
  const raw = details.reject_reasons || details.rejectReasons || details.warnings;
  const reasons = Array.isArray(raw) ? raw.map((v) => String(v)).filter(Boolean).slice(0, 8) : [];
  if (asset.risk === "high") reasons.push("high_identity_or_quality_risk");
  if (quality === "reject" && asset.qualityScore < 0.55) reasons.push("low_quality_score");
  return Array.from(new Set(reasons));
}

export function classifyProductTwin(twin: ProductTwin): ProductTwinClassification {
  const useCases: ProductTwinUseCase[] = ["hero", "broll", "ugc", "marketplace", "ads"];
  const canonical = Object.fromEntries(useCases.map((useCase) => [useCase, pickBestTwinAsset(twin.assets, useCase)?.assetId || null])) as Record<ProductTwinUseCase, string | null>;
  const assets = twin.assets.map((asset) => {
    const quality = classifyQuality(asset);
    return {
      assetId: asset.assetId,
      kind: asset.kind,
      type: classifyKind(asset),
      quality,
      qualityScore: asset.qualityScore,
      risk: asset.risk || "low",
      dominantColor: stringDetail(asset, ["dominant_color", "dominantColor"]) || null,
      objectSize: objectSize(asset),
      hasPackaging: asset.kind !== "object_mask" && twin.category === "cosmetics",
      hasHands: stringDetail(asset, ["scene", "source_kind", "sourceKind"]).toLowerCase().includes("hand"),
      suitableFor: {
        hero: Boolean(asset.heroReady),
        broll: Boolean(asset.brollReady),
        ugc: Boolean(asset.ugcReady),
        marketplace: Boolean(asset.marketplaceSafe),
        ads: Boolean(asset.adsSafe),
      },
      rejectReasons: rejectReasons(asset, quality),
    };
  });
  const readyAssets = assets.filter((asset) => asset.quality === "excellent" || asset.quality === "good").length;
  const reviewAssets = assets.filter((asset) => asset.quality === "review").length;
  return {
    twinId: twin.twinId,
    article: twin.article,
    category: twin.category,
    status: readyAssets > 0 && Boolean(canonical.broll || canonical.hero) ? "ready" : "needs_review",
    canonical,
    assets,
    summary: {
      totalAssets: assets.length,
      readyAssets,
      reviewAssets,
      bestQualityScore: assets.reduce((max, asset) => Math.max(max, asset.qualityScore), 0),
      heroReady: Boolean(canonical.hero),
      brollReady: Boolean(canonical.broll),
      ugcReady: Boolean(canonical.ugc),
      marketplaceReady: Boolean(canonical.marketplace),
      adsReady: Boolean(canonical.ads),
    },
  };
}
