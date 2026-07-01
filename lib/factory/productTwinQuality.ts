import sharp from "sharp";
import type { ProductTwinAssetKind, ProductTwinCategory } from "./productTwin";

export interface ProductTwinQualityResult {
  qualityScore: number;
  sharpnessScore: number;
  exposureScore: number;
  compositionScore: number;
  objectCoverage: number;
  labelDetailScore: number;
  backgroundCleanliness: number;
  identityRisk: "low" | "medium" | "high";
  rejectReasons: string[];
  heroReady: boolean;
  brollReady: boolean;
  marketplaceSafe: boolean;
  adsSafe: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function stddev(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function edgeScore(gray: Uint8Array, width: number, height: number): number {
  if (width < 2 || height < 2) return 0;
  let sum = 0, count = 0;
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = y * width + x;
      sum += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]);
      count += 2;
    }
  }
  return count ? clamp01((sum / count) / 12) : 0;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function estimateObjectCoverage(input: {
  rgba: Uint8Array;
  width: number;
  height: number;
}): { coverage: number; centerBias: number; backgroundCleanliness: number } {
  const { rgba, width, height } = input;
  if (!width || !height) return { coverage: 0, centerBias: 0, backgroundCleanliness: 0 };
  const cornerRgb = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i] || 255, rgba[i + 1] || 255, rgba[i + 2] || 255];
  };
  const samples = [
    cornerRgb(0, 0),
    cornerRgb(width - 1, 0),
    cornerRgb(0, height - 1),
    cornerRgb(width - 1, height - 1),
  ];
  const bg = [0, 1, 2].map((ch) => Math.round(mean(samples.map((s) => s[ch]))));
  let foreground = 0;
  let cx = 0;
  let cy = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const cornerDiffs: number[] = [];
  for (const s of samples) {
    cornerDiffs.push(Math.abs(s[0] - bg[0]) + Math.abs(s[1] - bg[1]) + Math.abs(s[2] - bg[2]));
  }
  for (let p = 0, idx = 0; p < rgba.length; p += 4, idx++) {
    const alpha = rgba[p + 3] ?? 255;
    const dist = Math.abs((rgba[p] || 0) - bg[0]) + Math.abs((rgba[p + 1] || 0) - bg[1]) + Math.abs((rgba[p + 2] || 0) - bg[2]);
    const isForeground = alpha > 24 && (alpha < 245 || dist > 34);
    if (!isForeground) continue;
    const x = idx % width;
    const y = Math.floor(idx / width);
    foreground++;
    cx += x;
    cy += y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const total = Math.max(1, width * height);
  const pixelCoverage = foreground / total;
  const extentCoverage = foreground ? (((maxX - minX + 1) * (maxY - minY + 1)) / total) : 0;
  const coverage = Math.max(pixelCoverage, extentCoverage * 0.62);
  if (!foreground) return { coverage: 0, centerBias: 0, backgroundCleanliness: clamp01(1 - stddev(cornerDiffs) / 80) };
  cx /= foreground;
  cy /= foreground;
  const centerDistance = Math.sqrt(Math.pow((cx / width) - 0.5, 2) + Math.pow((cy / height) - 0.5, 2));
  return {
    coverage: clamp01(coverage),
    centerBias: clamp01(1 - centerDistance / 0.42),
    backgroundCleanliness: clamp01(1 - stddev(cornerDiffs) / 80),
  };
}

function serviceAsset(kind: ProductTwinAssetKind): boolean {
  return ["object_mask", "alpha", "depth_map", "segmentation"].includes(kind);
}

export async function assessProductTwinImage(input: {
  buffer: Buffer;
  kind: ProductTwinAssetKind;
  category: ProductTwinCategory;
}): Promise<ProductTwinQualityResult> {
  const meta = await sharp(input.buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const rejectReasons: string[] = [];

  const small = await sharp(input.buffer)
    .resize(96, 96, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Array.from(small.data as Uint8Array);
  const mean = pixels.length ? pixels.reduce((a, b) => a + b, 0) / pixels.length : 0;
  const sd = stddev(pixels);
  const sharpnessScore = edgeScore(small.data as Uint8Array, small.info.width, small.info.height);
  const exposureScore = clamp01(1 - Math.abs(mean - 170) / 150);
  const contrastScore = clamp01(sd / 72);
  const compositionScore = width && height ? clamp01(Math.min(width, height) / 1200) : 0;
  const sample = await sharp(input.buffer)
    .resize(160, 160, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const objectStats = estimateObjectCoverage({
    rgba: sample.data as Uint8Array,
    width: sample.info.width,
    height: sample.info.height,
  });
  const objectCoverage = objectStats.coverage;
  const objectCoverageScore = clamp01(1 - Math.abs(objectCoverage - 0.34) / 0.34);
  const labelDetailScore = clamp01((sharpnessScore * 0.72) + (contrastScore * 0.28));
  const backgroundCleanliness = objectStats.backgroundCleanliness;

  if (width < 900 || height < 900) rejectReasons.push("low_resolution");
  if (!serviceAsset(input.kind) && objectCoverage < 0.035) rejectReasons.push("object_too_small_or_missing");
  if (!serviceAsset(input.kind) && objectCoverage > 0.82) rejectReasons.push("object_overfills_frame");
  if (sharpnessScore < 0.2) rejectReasons.push("soft_or_low_detail");
  if (exposureScore < 0.45) rejectReasons.push("bad_exposure");
  if (contrastScore < 0.12 && !["alpha", "object_mask", "depth_map"].includes(input.kind)) rejectReasons.push("low_contrast");
  if (backgroundCleanliness < 0.55 && !serviceAsset(input.kind)) rejectReasons.push("busy_background");

  let identityRisk: ProductTwinQualityResult["identityRisk"] = rejectReasons.length ? "medium" : "low";
  if (input.category === "cosmetics" && ["clean_png", "shadow_bg", "upscaled", "white_bg"].includes(input.kind) && labelDetailScore < 0.26) {
    identityRisk = "high";
    rejectReasons.push("cosmetics_label_detail_risk");
  }
  if (input.category === "toy" && ["clean_png", "shadow_bg", "upscaled", "white_bg"].includes(input.kind) && labelDetailScore < 0.2) {
    identityRisk = "medium";
    rejectReasons.push("toy_detail_risk");
  }
  if (rejectReasons.length >= 3) identityRisk = "high";

  const qualityScore = round2(clamp01(
    sharpnessScore * 0.22 +
    exposureScore * 0.16 +
    contrastScore * 0.12 +
    compositionScore * 0.12 +
    objectCoverageScore * 0.16 +
    objectStats.centerBias * 0.1 +
    backgroundCleanliness * 0.07 +
    (identityRisk === "low" ? 0.05 : identityRisk === "medium" ? 0.02 : 0),
  ));

  const visualReady = !serviceAsset(input.kind) && qualityScore >= 0.42 && identityRisk !== "high" && !rejectReasons.includes("object_too_small_or_missing");
  const heroReady = visualReady && qualityScore >= 0.46 && ["white_bg", "gray_bg", "shadow_bg", "upscaled"].includes(input.kind);
  const brollReady = visualReady && ["clean_png", "shadow_bg", "white_bg", "upscaled"].includes(input.kind);
  return {
    qualityScore,
    sharpnessScore: round2(sharpnessScore),
    exposureScore: round2(exposureScore),
    compositionScore: round2(compositionScore),
    objectCoverage: round2(objectCoverage),
    labelDetailScore: round2(labelDetailScore),
    backgroundCleanliness: round2(backgroundCleanliness),
    identityRisk,
    rejectReasons,
    heroReady,
    brollReady,
    marketplaceSafe: heroReady && qualityScore >= 0.58 && identityRisk === "low",
    adsSafe: visualReady && qualityScore >= 0.48,
  };
}
