import { categoryFor, buildMotionPrompt, type ProductCategory } from "./editPrompts";
import { type FalVideoModel } from "./falVideo";

export type ProductBrollRecipe = "skincare_ritual" | "toy_action" | "bag_lookbook";

export interface ProductBrollVariant {
  id: string;
  label: string;
  prompt: string;
  model: FalVideoModel;
  duration: "5" | "10";
}

export interface ProductBrollPlanInput {
  article: string;
  product?: string;
  category?: ProductCategory;
  recipe?: ProductBrollRecipe;
  count?: number;
  model?: FalVideoModel;
}

const MAX_VARIANTS = 20;

const SKINCARE_MOVES = [
  {
    id: "texture-hook",
    label: "macro texture hook",
    motion: "Camera: slow macro push-in from the product label to the texture beside it, soft hand movement at frame edge.",
  },
  {
    id: "hand-pickup",
    label: "hand pickup",
    motion: "Camera: locked close-up as a hand gently picks up the product, then a tiny push-in as it settles.",
  },
  {
    id: "vanity-orbit",
    label: "vanity orbit",
    motion: "Camera: slow smooth orbital track around the product on a clean vanity surface.",
  },
  {
    id: "cap-detail",
    label: "cap detail",
    motion: "Camera: close-up push toward the cap and label edge, with a subtle rack-focus from foreground to product.",
  },
  {
    id: "morning-light",
    label: "morning light",
    motion: "Camera: gentle vertical tilt through soft daylight, ending on the product as the hero object.",
  },
  {
    id: "shelf-hero",
    label: "shelf hero",
    motion: "Camera: minimal side slide across a bathroom shelf, stopping with the product centered and dominant.",
  },
  {
    id: "dropper-ritual",
    label: "ritual gesture",
    motion: "Camera: static premium close-up with one calm hand gesture near the product, no fast movement.",
  },
  {
    id: "clean-packshot",
    label: "clean packshot",
    motion: "Camera: very slow push-in on a clean product packshot, stable and editorial.",
  },
  {
    id: "mirror-glint",
    label: "mirror glint",
    motion: "Camera: soft parallax slide with a gentle mirror reflection glint behind the product.",
  },
  {
    id: "routine-ending",
    label: "routine ending",
    motion: "Camera: slow pull-back revealing the product as the final step of a minimal skincare routine.",
  },
];

const TOY_ACTION_MOVES = [
  {
    id: "water-burst-hook",
    label: "water burst hook",
    motion: "Camera: locked close-up as a bright water burst crosses behind the toy, then a tiny push-in to the product.",
  },
  {
    id: "backyard-hero",
    label: "backyard hero",
    motion: "Camera: slow low-angle push-in on the toy in sunny backyard grass, playful summer energy.",
  },
  {
    id: "hand-grab",
    label: "hand grab",
    motion: "Camera: static close-up as a hand grabs the toy handle, product remains fully visible and stable.",
  },
  {
    id: "splash-table",
    label: "splash table",
    motion: "Camera: smooth side slide across a wet outdoor table, stopping on the toy as the hero object.",
  },
  {
    id: "pool-edge",
    label: "pool edge",
    motion: "Camera: gentle push-in with soft pool-water bokeh behind the toy, no fast object movement.",
  },
  {
    id: "feature-detail",
    label: "feature detail",
    motion: "Camera: close-up push toward the nozzle and tank area, subtle rack-focus, every part stays sharp.",
  },
  {
    id: "summer-packshot",
    label: "summer packshot",
    motion: "Camera: slow clean packshot push-in, toy centered against bright summer props and water droplets.",
  },
  {
    id: "action-ready",
    label: "action ready",
    motion: "Camera: minimal handheld-style micro-move as the toy is placed down ready for play, stable product shape.",
  },
  {
    id: "grass-parallax",
    label: "grass parallax",
    motion: "Camera: slow parallax slide through foreground grass, ending on a crisp hero shot of the toy.",
  },
  {
    id: "final-splash",
    label: "final splash",
    motion: "Camera: slow pull-back from the toy as a soft splash lands in the background, product remains untouched.",
  },
];

const BAG_LOOKBOOK_MOVES = [
  {
    id: "hero-push",
    label: "hero push-in",
    motion: "Camera: slow clean push-in on the bag as a hero object on a minimal surface, soft studio light grazing the material.",
  },
  {
    id: "leather-macro",
    label: "leather macro",
    motion: "Camera: slow macro glide across the grain and stitching, then a gentle pull-back revealing the whole silhouette.",
  },
  {
    id: "hardware-detail",
    label: "hardware detail",
    motion: "Camera: close-up push toward the metal hardware, buckle and logo plate with a subtle rack-focus, no fast movement.",
  },
  {
    id: "strap-drape",
    label: "strap drape",
    motion: "Camera: soft side slide following the strap as it drapes, ending on the front of the bag centered and dominant.",
  },
  {
    id: "shoulder-carry",
    label: "shoulder carry",
    motion: "Camera: locked medium shot as a hand lifts the bag by the strap onto the shoulder, calm editorial pacing.",
  },
  {
    id: "turntable",
    label: "slow turntable",
    motion: "Camera: smooth slow orbital track around the bag on a clean surface, showing front and side profile.",
  },
  {
    id: "flap-open",
    label: "flap gesture",
    motion: "Camera: static premium close-up as one calm hand opens the flap and lets it settle, product stays fully intact.",
  },
  {
    id: "flatlay-rise",
    label: "flatlay rise",
    motion: "Camera: top-down flat-lay of the bag on a neutral surface, slow vertical rise to a three-quarter hero angle.",
  },
  {
    id: "window-light",
    label: "window light",
    motion: "Camera: gentle tilt through soft daylight, ending on the bag as the hero with warm calm mood.",
  },
  {
    id: "in-hand-walk",
    label: "in-hand walk",
    motion: "Camera: minimal handheld-style micro-move as the bag is carried in hand, silhouette and hardware stay crisp.",
  },
];

function clampCount(count: number | undefined): number {
  const n = Number.isFinite(count) && Number(count) > 0 ? Number(count) : 10;
  return Math.max(1, Math.min(MAX_VARIANTS, Math.round(n)));
}

function stableCategory(input: ProductBrollPlanInput): ProductCategory {
  return input.category || categoryFor(input.article, input.product || "");
}

function preservationClose(product: string, category: ProductCategory): string {
  const core = `The ${product} stays exactly as in the source image: stable, centered, intact, no shape change, no morphing, crisp edges, readable label.`;
  if (category === "cosmetics") return `${core} Keep cap, pump, printed text, bottle silhouette and fill level undistorted.`;
  if (category === "apparel") return `${core} Keep seams, zipper, hood, fabric texture and garment drape realistic.`;
  if (category === "bag") return `${core} Keep stitching, leather grain, zipper pulls and hardware undistorted.`;
  if (category === "toy") return `${core} Keep nozzle, trigger, tank, colour zones and printed graphics intact and correctly placed.`;
  return core;
}

function movesFor(recipe: ProductBrollRecipe | undefined, category: ProductCategory) {
  if (recipe === "toy_action" || category === "toy") return TOY_ACTION_MOVES;
  if (recipe === "bag_lookbook" || category === "bag") return BAG_LOOKBOOK_MOVES;
  return SKINCARE_MOVES;
}

export function buildProductBrollPlan(input: ProductBrollPlanInput): ProductBrollVariant[] {
  const category = stableCategory(input);
  const product = (input.product || input.article || "product").trim().slice(0, 120);
  const model = input.model || "kling";
  const count = clampCount(input.count);
  const fallbackMotion = buildMotionPrompt({ category, product });
  const close = preservationClose(product, category);
  const moves = movesFor(input.recipe, category);

  return moves.slice(0, count).map((move, idx) => ({
    id: `${input.article || "sku"}:${move.id}:${idx + 1}`,
    label: move.label,
    model,
    duration: "5",
    prompt: [
      move.motion || fallbackMotion,
      close,
      "Premium product b-roll, realistic micro-motion, calm social-commerce pacing, no captions, no text overlays, no extra products.",
    ].join(" "),
  }));
}
