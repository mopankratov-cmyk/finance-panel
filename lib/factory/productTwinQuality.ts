import sharp from "sharp";
import type { ProductTwinAssetKind, ProductTwinCategory } from "./productTwin";

export interface ProductTwinQualityResult {
  qualityScore: number;
  sharpnessScore: number;
  exposureScore: number;
  compositionScore: number;
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

  if (width < 900 || height < 900) rejectReasons.push("low_resolution");
  if (sharpnessScore < 0.28) rejectReasons.push("soft_or_low_detail");
  if (exposureScore < 0.45) rejectReasons.push("bad_exposure");
  if (contrastScore < 0.22) rejectReasons.push("low_contrast");

  let identityRisk: ProductTwinQualityResult["identityRisk"] = rejectReasons.length ? "medium" : "low";
  if (input.category === "cosmetics" && input.kind === "clean_png" && sharpnessScore < 0.38) {
    identityRisk = "high";
    rejectReasons.push("cosmetics_label_detail_risk");
  }
  if (rejectReasons.length >= 3) identityRisk = "high";

  const qualityScore = round2(clamp01(
    sharpnessScore * 0.34 +
    exposureScore * 0.22 +
    contrastScore * 0.18 +
    compositionScore * 0.18 +
    (identityRisk === "low" ? 0.08 : identityRisk === "medium" ? 0.03 : 0),
  ));

  const ready = qualityScore >= 0.68 && identityRisk !== "high";
  return {
    qualityScore,
    sharpnessScore: round2(sharpnessScore),
    exposureScore: round2(exposureScore),
    compositionScore: round2(compositionScore),
    identityRisk,
    rejectReasons,
    heroReady: ready && ["white_bg", "gray_bg", "shadow_bg", "upscaled"].includes(input.kind),
    brollReady: ready && ["clean_png", "shadow_bg", "white_bg", "upscaled"].includes(input.kind),
    marketplaceSafe: ready && identityRisk === "low",
    adsSafe: qualityScore >= 0.55 && identityRisk !== "high",
  };
}
