import { articleForPath, diskById, normColor, NORVIA_LINE, sourceFor } from "./contentDisks";
import { yaCollectImages, yaDownloadHref, type YaItem } from "@/lib/yandex/disk";
import sharp from "sharp";
import { focusProductSourceImage } from "./productSourceCrop";
import { normalizeTwinCategory, type ProductTwinCategory } from "./productTwin";
import { buildApparelSourcePack, type ApparelSourceRole } from "./apparelSourcePack";
import { buildBagSourcePack, type BagSourceRole } from "./bagSourcePack";

export interface ProductSourceCandidate {
  disk: string;
  path: string;
  name: string;
  score: number;
  reasons: string[];
  diagnostics?: ProductSourceDiagnostics;
}

export interface ProductSourceDiagnostics {
  width: number;
  height: number;
  megapixels: number;
  sharpness: number;
  contrast: number;
  focusCropApplied: boolean;
  focusStrategy?: string;
  subjectCoverage?: number;
  subjectExtent?: number;
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
  return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
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

function norviaLineForPath(path: string): string | null {
  const lineFolder = path.replace(/^\/+/, "").split("/")[0]?.trim();
  return lineFolder ? NORVIA_LINE[lineFolder] || null : null;
}

function norviaColorFolder(path: string): string {
  return path.replace(/^\/+/, "").split("/")[1]?.trim() || "";
}

function sourceScore(item: YaItem, article: string, category: ProductTwinCategory, diskId: string, product = ""): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const name = item.name.toLowerCase();
  if (!item.isImage) return { score: -100, reasons: ["not_image"] };
  if (/обложк|cover|логотип|brand|screenshot|icon/i.test(item.name)) return { score: -50, reasons: ["service_or_cover"] };
  if (/инфограф|infograph|коллаж|collage|до.?после|before.?after/i.test(item.name)) { score -= 4; reasons.push("poster_or_collage_name"); }
  if (/\.png$/i.test(item.name)) { score += 2; reasons.push("png"); }
  if (/\.(jpe?g|webp)$/i.test(item.name)) { score += 1; reasons.push("photo_file"); }
  if (category === "apparel" && diskId === "norvia") {
    if (/^IMG_[67]\d{3}\.JPG$/.test(item.name)) { score += 6; reasons.push("norvia_raw_photoshoot"); }
    else if (/\.png$/i.test(item.name)) { score -= 4; reasons.push("apparel_png_export_penalty"); }
  }
  if (/^1\./.test(name) || /^2\./.test(name)) { score += category === "bag" ? 3 : 2; reasons.push("early_packshot_candidate"); }
  if (/^([3-9]|1[0-9])\./.test(name)) { score += 1; reasons.push("alternate_source_candidate"); }
  if (/new/i.test(item.path)) { score += 2; reasons.push("new_folder"); }
  if (/светл/i.test(item.path)) { score += 1; reasons.push("light_variant"); }
  if (articleForPath(diskId, item.path) === article) { score += 4; reasons.push("article_folder_match"); }
  if (diskId === "norvia") {
    const line = norviaLineForPath(item.path);
    if (line && (article === line || article.startsWith(line + "-"))) { score += 8; reasons.push("norvia_line_match"); }
    else if (line && /^NV[-\s]?/i.test(article)) { score -= 8; reasons.push("norvia_line_mismatch"); }
    const wantedColor = normColor(product);
    const folderColor = normColor(norviaColorFolder(item.path));
    if (folderColor && wantedColor && (wantedColor.includes(folderColor) || folderColor.includes(wantedColor))) {
      score += 5;
      reasons.push("norvia_color_match");
    }
  }
  return { score, reasons };
}

function subjectMassStats(rgba: Uint8Array, width: number, height: number, category: ProductTwinCategory): { coverage: number; extent: number } | null {
  if (category !== "bag" || width < 2 || height < 2) return null;
  let hits = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let p = 0, idx = 0; p < rgba.length; p += 4, idx++) {
    const alpha = rgba[p + 3] ?? 255;
    if (alpha < 24) continue;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < width * 0.05 || x > width * 0.95 || y < height * 0.08 || y > height * 0.95) continue;
    const r = rgba[p] || 0;
    const g = rgba[p + 1] || 0;
    const b = rgba[p + 2] || 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma > 80) continue;
    hits++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!hits) return { coverage: 0, extent: 0 };
  const total = Math.max(1, width * height);
  return {
    coverage: hits / total,
    extent: ((maxX - minX + 1) * (maxY - minY + 1)) / total,
  };
}

function candidateSort(a: ProductSourceCandidate, b: ProductSourceCandidate): number {
  return b.score - a.score
    || (b.diagnostics?.sharpness || 0) - (a.diagnostics?.sharpness || 0)
    || (b.diagnostics?.contrast || 0) - (a.diagnostics?.contrast || 0)
    || a.path.localeCompare(b.path);
}

const APPAREL_SOURCE_PACK_ROLE_BOOST: Partial<Record<ApparelSourceRole, number>> = {
  clean_front: 30,
  on_model_front: 14,
  side: 8,
  back: 8,
  fabric_macro: 4,
  closure_detail: 2,
  hood_detail: 2,
  lining_detail: 2,
};

const BAG_SOURCE_PACK_ROLE_BOOST: Partial<Record<BagSourceRole, number>> = {
  front: 26,
  three_quarter: 18,
  in_hand: 10,
  hardware_macro: 8,
  side: 6,
  back: 6,
  strap_detail: 4,
  on_shoulder: 4,
};

async function apparelSourcePackCandidates(input: {
  article: string;
  product: string;
  category: ProductTwinCategory;
  diskId: string;
}): Promise<ProductSourceCandidate[]> {
  if (input.category !== "apparel" || input.diskId !== "norvia") return [];
  const pack = await buildApparelSourcePack({ article: input.article, product: input.product, limitPerRole: 1 });
  if ("error" in pack) return [];
  return (Object.values(pack.roles).filter(Boolean) as NonNullable<(typeof pack.roles)[ApparelSourceRole]>[]).map((asset) => ({
    disk: asset.disk,
    path: asset.path,
    name: asset.name,
    score: asset.score + (APPAREL_SOURCE_PACK_ROLE_BOOST[asset.role] || 0),
    reasons: [...asset.reasons, `source_pack_role:${asset.role}`],
  }));
}

async function bagSourcePackCandidates(input: {
  article: string;
  product: string;
  category: ProductTwinCategory;
  diskId: string;
}): Promise<ProductSourceCandidate[]> {
  if (input.category !== "bag" || input.diskId !== "design") return [];
  const pack = await buildBagSourcePack({ article: input.article, product: input.product, limitPerRole: 1 });
  if ("error" in pack) return [];
  return (Object.values(pack.roles).filter(Boolean) as NonNullable<(typeof pack.roles)[BagSourceRole]>[]).map((asset) => ({
    disk: asset.disk,
    path: asset.path,
    name: asset.name,
    score: asset.score + (BAG_SOURCE_PACK_ROLE_BOOST[asset.role] || 0),
    reasons: [...asset.reasons, `source_pack_role:${asset.role}`],
  }));
}

async function probeCandidate(input: {
  candidate: ProductSourceCandidate;
  diskKey: string;
  category: ProductTwinCategory;
  article: string;
}): Promise<ProductSourceCandidate> {
  try {
    const href = await yaDownloadHref(input.candidate.path, input.diskKey);
    if (!href) return { ...input.candidate, score: input.candidate.score - 1, reasons: [...input.candidate.reasons, "download_href_missing"] };
    const res = await fetch(href, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { ...input.candidate, score: input.candidate.score - 1, reasons: [...input.candidate.reasons, `download_${res.status}`] };
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return { ...input.candidate, score: input.candidate.score - 2, reasons: [...input.candidate.reasons, "empty_buffer"] };
    const focused = await focusProductSourceImage({ buffer, contentType, category: input.category, article: input.article });
    const diagnosticBuffer = focused.applied ? focused.buffer : buffer;
    const meta = await sharp(diagnosticBuffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const small = await sharp(diagnosticBuffer)
      .resize(128, 128, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const gray = await sharp(diagnosticBuffer)
      .resize(128, 128, { fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = Array.from(gray.data as Uint8Array);
    const sharpness = edgeScore(gray.data as Uint8Array, gray.info.width, gray.info.height);
    const contrast = clamp01(stddev(pixels) / 72);
    const subject = subjectMassStats(small.data as Uint8Array, small.info.width, small.info.height, input.category);
    const megapixels = width * height / 1_000_000;
    let score = input.candidate.score;
    const reasons = [...input.candidate.reasons];
    if (width >= 1200 && height >= 1200) { score += 3; reasons.push("high_resolution"); }
    else if (width >= 900 && height >= 900) { score += 1; reasons.push("usable_resolution"); }
    else { score -= 3; reasons.push("low_resolution_source"); }
    if (input.category === "apparel" && megapixels >= 8) { score += 3; reasons.push("apparel_large_raw_source"); }
    score += Math.round(sharpness * 4);
    score += Math.round(contrast * 2);
    if (sharpness >= 0.2) { score += 3; reasons.push("sharp_source"); }
    else if (sharpness >= 0.14) { score += 1; reasons.push("acceptable_detail"); }
    else { score -= 3; reasons.push("soft_source"); }
    if (contrast >= 0.18) { score += 1; reasons.push("usable_contrast"); }
    else { score -= 1; reasons.push("low_contrast_source"); }
    if (focused.applied) { score += 2; reasons.push("focus_crop_applied"); }
    if (subject) {
      if (subject.coverage >= 0.055 && subject.coverage <= 0.2 && subject.extent <= 0.55) {
        score += 4;
        reasons.push("bag_subject_scale_ok");
      } else if (subject.coverage > 0.26 || subject.extent > 0.72) {
        score -= 5;
        reasons.push("bag_source_too_dense_or_poster_like");
      } else if (subject.coverage < 0.035) {
        score -= 2;
        reasons.push("bag_subject_too_small");
      }
    }
    return {
      ...input.candidate,
      score,
      reasons,
      diagnostics: {
        width,
        height,
        megapixels: round2(megapixels),
        sharpness: round2(sharpness),
        contrast: round2(contrast),
        focusCropApplied: focused.applied,
        focusStrategy: focused.applied ? focused.strategy : undefined,
        subjectCoverage: subject ? round2(subject.coverage) : undefined,
        subjectExtent: subject ? round2(subject.extent) : undefined,
      },
    };
  } catch {
    return { ...input.candidate, score: input.candidate.score - 1, reasons: [...input.candidate.reasons, "probe_failed"] };
  }
}

export async function pickProductSourceCandidates(input: {
  article: string;
  product?: string;
  limit?: number;
  probeLimit?: number;
}): Promise<ProductSourceCandidate[]> {
  const source = sourceFor(input.product || input.article, input.article);
  if (!source) return [];
  const disk = diskById(source.disk.id);
  if (!disk) return [];
  const category = normalizeTwinCategory(undefined, input.article, input.product || input.article);
  const candidates: ProductSourceCandidate[] = [];
  const sourcePackCandidates = await apparelSourcePackCandidates({
    article: input.article,
    product: input.product || input.article,
    category,
    diskId: disk.id,
  });
  sourcePackCandidates.push(...await bagSourcePackCandidates({
    article: input.article,
    product: input.product || input.article,
    category,
    diskId: disk.id,
  }));
  for (const root of source.paths) {
    const images = await yaCollectImages(root, 2, disk.key);
    for (const image of images) {
      const s = sourceScore(image, input.article, category, disk.id, input.product || "");
      if (s.score < 0) continue;
      candidates.push({ disk: disk.id, path: image.path, name: image.name, score: s.score, reasons: s.reasons });
    }
  }
  for (const candidate of sourcePackCandidates) {
    const existing = candidates.find((item) => item.disk === candidate.disk && item.path === candidate.path);
    if (existing) {
      existing.score += candidate.score;
      existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
    } else {
      candidates.push(candidate);
    }
  }
  candidates.sort(candidateSort);
  const probeLimit = Math.max(0, Math.min(20, input.probeLimit ?? 10));
  const limit = Math.max(1, Math.min(50, input.limit ?? 12));
  const probed = await Promise.all(candidates.slice(0, probeLimit).map((candidate) => probeCandidate({
    candidate,
    diskKey: disk.key,
    category,
    article: input.article,
  })));
  const rest = candidates.slice(probeLimit);
  return [...probed, ...rest].sort(candidateSort).slice(0, limit);
}

export async function pickProductSource(input: { article: string; product?: string }): Promise<ProductSourceCandidate | null> {
  const candidates = await pickProductSourceCandidates({ ...input, limit: 1, probeLimit: 10 });
  return candidates[0] || null;
}
