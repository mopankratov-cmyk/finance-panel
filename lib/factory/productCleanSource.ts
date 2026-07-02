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
      "Preserve the exact toy shape, proportions, colour zones, nozzle, trigger, tank, barrel, product decals, printed markings on the toy and molded details.",
      "Remove all people, hands, water streams, fire/glow effects, background Russian promo text, badges, checkmarks, EAC marks, background graphics and infographic design elements.",
      "Do not remove or rewrite real markings printed directly on the toy body.",
      "Place the complete toy centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "No extra text, no hands, no people, no water stream, no fire, no extra objects.",
      "Keep the full product visible with a small studio margin on all sides. Vertical 9:16 composition, photorealistic, sharp product edges.",
    ].join(" ");
  }

  if (category === "cosmetics") {
    return [
      `Extract only the ${product} from this ecommerce/lifestyle source and recreate it as a clean professional product packshot.`,
      "Preserve the exact bottle/jar shape, cap, pump if present, cap-body seam, white material warmth, printed SPF/shade text, brand logo, label placement, label scale, package proportions, barcode-free visible packaging details and tiny label blocks.",
      "Do not simplify the packaging into a generic blank bottle. Do not remove, rewrite, blur, enlarge, translate or invent real product markings that are printed on the packaging.",
      "Remove all surrounding infographic text, skin photos, claims, plus icons, badges, panels, hands, faces, props and background graphics.",
      "Keep only the real product packaging text; remove text that belongs to the ecommerce poster around the product.",
      "Place the product centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "No extra text outside the product, no extra objects, no hands, no face, no before-after image.",
      "Keep the full package visible with a small studio margin on all sides. Vertical 9:16 composition, photorealistic, sharp product edges.",
    ].join(" ");
  }

  if (category === "apparel") {
    return [
      `Extract only the ${product} garment from this model/lifestyle/source image and recreate it as a clean professional apparel product twin.`,
      "Preserve the exact garment cut, length, hood/collar, sleeves, cuffs, zipper/buttons, pockets, seams, stitching, fabric texture, wrinkles, color and visible brand patch.",
      "Remove the model body, face, hair, hands, legs, shoes, background, props, hangers, text, badges and graphic overlays.",
      "Do not turn the garment into a generic jacket or shirt. Do not change fabric drape, color, proportions, closure type or seam layout.",
      "Show the complete garment centered as a ghost mannequin or flat clean packshot on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "Remove any brand typography, wordmarks or captions rendered outside the garment itself (including a brand name printed below the product on the card layout); keep only labels physically sewn onto the garment.",
      "Keep enough margin around the garment for marketplace use. No person, no extra objects, no captions.",
      "Vertical 9:16 composition, photorealistic, sharp fabric detail.",
    ].join(" ");
  }

  if (category === "bag") {
    return [
      `Extract only the ${product} bag from this model/lifestyle/source image and recreate it as a clean professional bag product twin.`,
      "Preserve the exact silhouette, size, handle and strap geometry, leather grain or fabric texture, stitching, zipper pulls, buckles, feet, logo plate and metal hardware color.",
      "Remove the model, hands, body, background, props, text, badges, price graphics and surrounding objects.",
      "Do not simplify the bag into a generic shape. Do not alter strap attachment points, hardware, logo placement, material finish or color.",
      "Show the complete bag centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
      "Remove any brand typography, wordmarks or captions rendered outside the bag itself (including a brand name printed below the product on the card layout); keep only markings physically attached to the bag.",
      "Keep full handles/strap visible when present, with clean marketplace margin. No person, no extra objects, no captions.",
      "Vertical 9:16 composition, photorealistic, sharp product edges and material detail.",
    ].join(" ");
  }

  return [
    `Extract only the ${product} from this source and recreate it as a clean professional product packshot.`,
    "Preserve the exact product shape, proportions, colour, material, logo, label text and visible details.",
    "Remove all surrounding text, people, hands, props, graphic overlays, badges and background clutter.",
    "Remove any brand typography or captions rendered outside the product itself; keep only markings physically on the product.",
    "Place the product centered on a seamless light warm-grey studio background with a soft natural contact shadow.",
    "No extra text, no extra objects.",
    "Vertical 9:16 composition, photorealistic, sharp product edges.",
  ].join(" ");
}

export function imageBufferToDataUrl(buf: Buffer, contentType = "image/png"): string {
  return `data:${contentType};base64,${buf.toString("base64")}`;
}
