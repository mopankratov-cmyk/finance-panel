import type { ProductTwinCategory } from "./productTwin";

export type ProductTwinViewTruth = "truthful_source" | "derived_from_source" | "synthetic_candidate";

export interface ProductTwinViewPlan {
  id: string;
  label: string;
  purpose: "clean" | "angle" | "detail" | "lifestyle" | "service";
  truth: ProductTwinViewTruth;
  required: boolean;
  prompt: string;
}

export interface ProductTwinPreparationPlan {
  version: "product_twin_prep_v1";
  category: ProductTwinCategory;
  sourceStrategy: string[];
  canonicalViews: ProductTwinViewPlan[];
  serviceAssets: ProductTwinViewPlan[];
  notes: string[];
}

function view(
  id: string,
  label: string,
  purpose: ProductTwinViewPlan["purpose"],
  truth: ProductTwinViewTruth,
  required: boolean,
  prompt: string,
): ProductTwinViewPlan {
  return { id, label, purpose, truth, required, prompt };
}

export function buildProductTwinPreparationPlan(input: {
  article: string;
  product: string;
  category: ProductTwinCategory;
}): ProductTwinPreparationPlan {
  const product = input.product || input.article;
  const serviceAssets = [
    view("object_mask", "Object mask", "service", "derived_from_source", true, "Binary product mask for compositing and object-aware video generation."),
    view("alpha", "Alpha channel", "service", "derived_from_source", true, "Transparent alpha asset for clean overlays and image-to-video grounding."),
    view("depth_map", "Depth map", "service", "derived_from_source", true, "Approximate product depth map for parallax and motion guidance."),
    view("segmentation", "Segmentation map", "service", "derived_from_source", true, "Two-class segmentation map: product and background."),
  ];

  if (input.category === "apparel") {
    return {
      version: "product_twin_prep_v1",
      category: input.category,
      sourceStrategy: [
        "Collect all article/color-matched source images from the apparel folder.",
        "Keep on-model photos as lifestyle/UGC truth sources.",
        "Create a separate clean garment twin by isolating the garment from model, hands, face and background.",
        "Prefer sources showing full front, back, side, fabric texture and closure details.",
      ],
      canonicalViews: [
        view("front_flat", "Front garment flat/ghost", "clean", "derived_from_source", true, `Clean front view of ${product}, full garment visible, preserve cut, seams, zipper, hood, cuffs, fabric texture and color.`),
        view("back_flat", "Back garment flat/ghost", "angle", "synthetic_candidate", true, `Back view candidate for ${product}; preserve same silhouette, fabric, hood, seams and length. Mark as synthetic until source-confirmed.`),
        view("left_45", "45 degrees left", "angle", "synthetic_candidate", true, `45 degree left garment view for ${product}, same cut, fabric drape, seams and hardware.`),
        view("right_45", "45 degrees right", "angle", "synthetic_candidate", true, `45 degree right garment view for ${product}, same cut, fabric drape, seams and hardware.`),
        view("fabric_macro", "Fabric macro", "detail", "derived_from_source", true, `Close-up crop of ${product} fabric texture, stitching, zipper tape, cuff or hood edge.`),
        view("closure_detail", "Closure/detail", "detail", "derived_from_source", false, `Detail crop of zipper, buttons, patch, pocket, drawcord or branded element on ${product}.`),
        view("on_model_front", "On-model front", "lifestyle", "truthful_source", true, `Truthful on-model source of ${product}, front view, useful for UGC and fit/drape references.`),
        view("on_model_motion", "On-model motion", "lifestyle", "truthful_source", false, `Truthful lifestyle source showing fabric movement, walking pose or natural drape for ${product}.`),
      ],
      serviceAssets,
      notes: [
        "For apparel, clean product twin and on-model UGC asset must be separate assets.",
        "Synthetic back/45-degree views are allowed only as candidates until confirmed by source images.",
      ],
    };
  }

  if (input.category === "bag") {
    return {
      version: "product_twin_prep_v1",
      category: input.category,
      sourceStrategy: [
        "Collect all article/color-matched bag sources from the model and product folders.",
        "Prefer full bag views with visible silhouette, strap, handle, hardware and leather grain.",
        "Keep in-hand/on-shoulder photos as truthful lifestyle/UGC assets.",
        "Create a separate clean bag cutout for marketplace, hero and b-roll.",
      ],
      canonicalViews: [
        view("front", "Front bag", "clean", "derived_from_source", true, `Clean front view of ${product}; preserve silhouette, leather grain, stitching, handle/strap geometry, zipper pulls and hardware color.`),
        view("back", "Back bag", "angle", "synthetic_candidate", true, `Back view candidate for ${product}; preserve exact size, strap attachment, stitching and material.`),
        view("side", "Side/gusset", "angle", "synthetic_candidate", true, `Side view of ${product}, showing gusset depth, handle attachment and bottom shape.`),
        view("three_quarter", "Three-quarter hero", "angle", "derived_from_source", true, `Three-quarter hero view of ${product}, suitable for premium packshot and b-roll source.`),
        view("inside_open", "Open/inside", "detail", "synthetic_candidate", false, `Open-bag interior candidate for ${product}; mark as synthetic unless source confirms lining and compartments.`),
        view("hardware_macro", "Hardware macro", "detail", "derived_from_source", true, `Close-up crop of ${product} zipper pull, buckle, logo plate, stitching or texture.`),
        view("in_hand", "In hand", "lifestyle", "truthful_source", true, `Truthful lifestyle source of ${product} in hand for UGC and social proof.`),
        view("on_shoulder", "On shoulder", "lifestyle", "truthful_source", false, `Truthful lifestyle source of ${product} worn on shoulder or cross-body if available.`),
      ],
      serviceAssets,
      notes: [
        "For bags, clean cutout must preserve leather grain and metal hardware; lifestyle assets should not overwrite clean twin.",
        "Interior view is synthetic-candidate unless the source folder contains an actual open-bag image.",
      ],
    };
  }

  if (input.category === "cosmetics") {
    return {
      version: "product_twin_prep_v1",
      category: input.category,
      sourceStrategy: [
        "Rank all source posters by resolution, sharpness and contrast before generation.",
        "Apply center label focus crop before clean generation.",
        "Reject b-roll readiness if label detail falls below threshold.",
      ],
      canonicalViews: [
        view("front_label", "Front label", "clean", "derived_from_source", true, `Clean front label view of ${product}; preserve logo, SPF/text blocks, cap and package proportions.`),
        view("left_45", "45 degrees left", "angle", "synthetic_candidate", false, `45 degree left candidate for ${product}; preserve cap, label placement and bottle geometry.`),
        view("right_45", "45 degrees right", "angle", "synthetic_candidate", false, `45 degree right candidate for ${product}; preserve cap, label placement and bottle geometry.`),
        view("cap_macro", "Cap/detail macro", "detail", "derived_from_source", true, `Close-up of cap, pump, label edge or texture detail for ${product}.`),
        view("in_hand", "In hand", "lifestyle", "synthetic_candidate", false, `UGC hand pickup candidate for ${product}, generated only after front label passes quality gate.`),
      ],
      serviceAssets,
      notes: ["Cosmetics b-roll is blocked until label detail is preserved."],
    };
  }

  if (input.category === "toy") {
    return {
      version: "product_twin_prep_v1",
      category: input.category,
      sourceStrategy: [
        "Prefer clean full-product sources with all toy parts visible.",
        "Preserve molded details, trigger, tank, nozzle and printed markings.",
      ],
      canonicalViews: [
        view("front", "Front toy", "clean", "derived_from_source", true, `Clean front view of ${product}; preserve nozzle, trigger, tank, color zones and printed markings.`),
        view("left_45", "45 degrees left", "angle", "synthetic_candidate", true, `45 degree left candidate for ${product}, same toy geometry and colors.`),
        view("right_45", "45 degrees right", "angle", "synthetic_candidate", true, `45 degree right candidate for ${product}, same toy geometry and colors.`),
        view("detail_nozzle", "Nozzle/detail", "detail", "derived_from_source", true, `Close-up of nozzle, trigger, tank seam or printed toy marking for ${product}.`),
        view("in_hand", "In hand", "lifestyle", "synthetic_candidate", false, `Hand pickup candidate for ${product}, useful for UGC and b-roll after clean twin passes gate.`),
      ],
      serviceAssets,
      notes: ["Toy detail views should not invent extra water streams or effects in the twin layer."],
    };
  }

  return {
    version: "product_twin_prep_v1",
    category: input.category,
    sourceStrategy: ["Collect best available product images, then separate clean packshot assets from lifestyle assets."],
    canonicalViews: [
      view("front", "Front product", "clean", "derived_from_source", true, `Clean front view of ${product}.`),
      view("left_45", "45 degrees left", "angle", "synthetic_candidate", false, `45 degree left candidate for ${product}.`),
      view("right_45", "45 degrees right", "angle", "synthetic_candidate", false, `45 degree right candidate for ${product}.`),
      view("detail", "Detail", "detail", "derived_from_source", false, `Close-up detail crop for ${product}.`),
    ],
    serviceAssets,
    notes: ["Unknown categories need manual review before synthetic angle assets are trusted."],
  };
}
