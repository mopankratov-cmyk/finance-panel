import { categoryFor, type ProductCategory } from "./editPrompts";

export interface ProductCleanSourceInput {
  article: string;
  product?: string;
  category?: ProductCategory;
}

function stableCategory(input: ProductCleanSourceInput): ProductCategory {
  return input.category || categoryFor(input.article, input.product || "");
}

export function buildProductCleanPrompt(input: ProductCleanSourceInput): string {
  const category = stableCategory(input);
  const product = (input.product || input.article || "product").trim().slice(0, 120);

  if (category === "toy") {
    return [
      `Extract only the ${product} from this product/lifestyle source and recreate it as a clean professional product packshot.`,
      "Preserve the exact toy shape, proportions, colour zones, nozzle, trigger, tank, barrel, printed markings and molded details.",
      "Remove all people, hands, water streams, fire/glow effects, Russian text, badges, checkmarks, EAC marks, background graphics and infographic design elements.",
      "Place the complete toy centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "No extra text, no hands, no people, no water stream, no fire, no extra objects.",
      "Vertical 9:16 composition, photorealistic, sharp product edges.",
    ].join(" ");
  }

  if (category === "cosmetics") {
    return [
      `Extract only the ${product} from this ecommerce/lifestyle source and recreate it as a clean professional product packshot.`,
      "Preserve the exact bottle/jar shape, cap, pump if present, cap-body seam, white material warmth, printed SPF/shade text, brand logo, label placement, label scale, package proportions and all visible packaging details.",
      "Do not simplify the packaging into a generic blank bottle. Do not remove real product markings that are printed on the packaging.",
      "Remove all surrounding infographic text, skin photos, claims, plus icons, badges, panels, hands, faces, props and background graphics.",
      "Place the product centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "No extra text outside the product, no extra objects, no hands, no face, no before-after image.",
      "Vertical 9:16 composition, photorealistic, sharp product edges.",
    ].join(" ");
  }

  return [
    `Extract only the ${product} from this source and recreate it as a clean professional product packshot.`,
    "Preserve the exact product shape, proportions, colour, material, logo, label text and visible details.",
    "Remove all surrounding text, people, hands, props, graphic overlays, badges and background clutter.",
    "Place the product centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
    "No extra text, no extra objects.",
    "Vertical 9:16 composition, photorealistic, sharp product edges.",
  ].join(" ");
}

export function imageBufferToDataUrl(buf: Buffer, contentType = "image/png"): string {
  return `data:${contentType};base64,${buf.toString("base64")}`;
}
