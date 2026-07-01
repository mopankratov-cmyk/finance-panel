import sharp from "sharp";
import type { ProductTwinCategory } from "./productTwin";

export interface ProductSourceFocusResult {
  buffer: Buffer;
  contentType: string;
  applied: boolean;
  strategy: string;
  sourceWidth: number;
  sourceHeight: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function expandBoxToAspect(input: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  aspect: number;
  margin: number;
}): { left: number; top: number; width: number; height: number } {
  const boxWidth = input.right - input.left + 1;
  const boxHeight = input.bottom - input.top + 1;
  let cropWidth = Math.round(boxWidth * (1 + input.margin * 2));
  let cropHeight = Math.round(boxHeight * (1 + input.margin * 2));
  if (cropWidth / cropHeight > input.aspect) cropHeight = Math.round(cropWidth / input.aspect);
  else cropWidth = Math.round(cropHeight * input.aspect);

  cropWidth = clamp(cropWidth, Math.min(input.width, 420), input.width);
  cropHeight = clamp(cropHeight, Math.min(input.height, 560), input.height);
  const cx = Math.round((input.left + input.right) / 2);
  const cy = Math.round((input.top + input.bottom) / 2);
  const left = clamp(Math.round(cx - cropWidth / 2), 0, Math.max(0, input.width - cropWidth));
  const top = clamp(Math.round(cy - cropHeight / 2), 0, Math.max(0, input.height - cropHeight));
  return { left, top, width: cropWidth, height: cropHeight };
}

async function focusBagSource(input: { buffer: Buffer; width: number; height: number }): Promise<Buffer | null> {
  const sampleWidth = 180;
  const sample = await sharp(input.buffer)
    .resize(sampleWidth, sampleWidth, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sx = input.width / sample.info.width;
  const sy = input.height / sample.info.height;
  let minX = sample.info.width;
  let minY = sample.info.height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let p = 0, idx = 0; p < sample.data.length; p += 4, idx++) {
    const alpha = sample.data[p + 3] ?? 255;
    if (alpha < 24) continue;
    const x = idx % sample.info.width;
    const y = Math.floor(idx / sample.info.width);
    const r = sample.data[p] || 0;
    const g = sample.data[p + 1] || 0;
    const b = sample.data[p + 2] || 0;
    const luma = luminance(r, g, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const inProductBand = x > sample.info.width * 0.05 && x < sample.info.width * 0.95 && y > sample.info.height * 0.08 && y < sample.info.height * 0.95;
    const likelyLeather = luma < 118 || (luma < 152 && chroma > 24);
    if (!inProductBand || !likelyLeather) continue;
    hits++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const hitRatio = hits / Math.max(1, sample.info.width * sample.info.height);
  if (hitRatio < 0.018 || hitRatio > 0.55 || maxX <= minX || maxY <= minY) return null;

  const crop = expandBoxToAspect({
    left: Math.floor(minX * sx),
    top: Math.floor(minY * sy),
    right: Math.ceil((maxX + 1) * sx),
    bottom: Math.ceil((maxY + 1) * sy),
    width: input.width,
    height: input.height,
    aspect: 4 / 5,
    margin: 0.42,
  });
  if (crop.width > input.width * 0.94 && crop.height > input.height * 0.94) return null;

  return sharp(input.buffer)
    .extract(crop)
    .resize(1600, 2000, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}

async function focusApparelSource(input: { buffer: Buffer; width: number; height: number }): Promise<Buffer | null> {
  if (input.width < 640 || input.height < 900 || input.height <= input.width) return null;
  if (input.width >= 1800 && input.height >= 2400) return null;
  const cropHeight = Math.round(input.height * 0.74);
  if (cropHeight < 640) return null;

  return sharp(input.buffer)
    .extract({ left: 0, top: 0, width: input.width, height: cropHeight })
    .resize(1600, 1900, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}

export async function focusProductSourceImage(input: {
  buffer: Buffer;
  contentType?: string;
  category: ProductTwinCategory;
  article?: string;
}): Promise<ProductSourceFocusResult> {
  const meta = await sharp(input.buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const base = {
    buffer: input.buffer,
    contentType: input.contentType || "image/png",
    applied: false,
    strategy: "none",
    sourceWidth: width,
    sourceHeight: height,
  };
  if (!width || !height) return base;

  if (input.category === "bag") {
    const focused = await focusBagSource({ buffer: input.buffer, width, height }).catch(() => null);
    if (focused) {
      return {
        buffer: focused,
        contentType: "image/png",
        applied: true,
        strategy: "bag_dark_product_focus_v1",
        sourceWidth: width,
        sourceHeight: height,
      };
    }
    return base;
  }

  if (input.category === "apparel") {
    const focused = await focusApparelSource({ buffer: input.buffer, width, height }).catch(() => null);
    if (focused) {
      return {
        buffer: focused,
        contentType: "image/png",
        applied: true,
        strategy: "apparel_poster_overlay_trim_v1",
        sourceWidth: width,
        sourceHeight: height,
      };
    }
    return base;
  }

  if (input.category !== "cosmetics") return base;

  const cropWidth = Math.round(width * (width >= height ? 0.58 : 0.68));
  const cropHeight = Math.round(height * 0.92);
  if (cropWidth < 320 || cropHeight < 320) return base;

  const left = clamp(Math.round((width - cropWidth) / 2), 0, Math.max(0, width - cropWidth));
  const top = clamp(Math.round((height - cropHeight) * 0.44), 0, Math.max(0, height - cropHeight));
  const focused = await sharp(input.buffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(1600, 2200, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  return {
    buffer: focused,
    contentType: "image/png",
    applied: true,
    strategy: "cosmetics_center_label_focus_v1",
    sourceWidth: width,
    sourceHeight: height,
  };
}
