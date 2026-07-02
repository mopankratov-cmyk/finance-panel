export type ProductBrollHumanVerdict = "winner" | "usable" | "weak" | "reject";

export type ProductBrollRejectReason =
  | "wrong_source"
  | "packshot_only"
  | "risk_high"
  | "low_quality"
  | "identity_drift"
  | "category_too_complex"
  | "artifact_detected"
  | "frames_unavailable"
  | "boring_motion"
  | "bad_background"
  | "morphing"
  | "not_ad_ready";

export interface ProductBrollSourceGateInput {
  sourceKind?: string | null;
  assetKind?: string | null;
  assetQuality?: number | null;
  assetRisk?: string | null;
  viewId?: string | null;
  submit?: boolean;
  allowPackshot?: boolean;
}

export interface ProductBrollSourceGate {
  ok: boolean;
  severity: "pass" | "review" | "block";
  reasons: ProductBrollRejectReason[];
  recommendation: string;
}

export interface ProductBrollExperimentPlanInput extends ProductBrollSourceGateInput {
  article: string;
  product?: string;
  category?: string | null;
  recipe?: string;
  model?: string;
  variants?: { id: string; label: string }[];
  autonomous?: boolean;
}

export interface ProductBrollQualityInput {
  article: string;
  product?: string | null;
  category?: string | null;
  sourceKind?: string | null;
  viewId?: string | null;
  frameCount?: number;
  artifact?: {
    ok?: boolean;
    severity?: "clean" | "minor" | "broken" | string;
    defects?: string[];
    note?: string;
    error?: string;
  } | null;
  manualOverride?: boolean;
}

const PACKSHOT_KINDS = new Set(["shadow_bg", "white_bg", "gray_bg"]);
const SERVICE_KINDS = new Set(["object_mask", "alpha", "depth_map", "segmentation"]);

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function assessProductBrollSource(input: ProductBrollSourceGateInput): ProductBrollSourceGate {
  const sourceKind = normalized(input.sourceKind);
  const assetKind = normalized(input.assetKind);
  const risk = normalized(input.assetRisk);
  const quality = Number(input.assetQuality);
  const hasQuality = Number.isFinite(quality) && quality > 0;
  const isDerivedView = Boolean(input.viewId) || sourceKind === "product_twin_view";
  const reasons: ProductBrollRejectReason[] = [];

  if (SERVICE_KINDS.has(assetKind)) reasons.push("wrong_source");
  if (risk === "high") reasons.push("risk_high");
  if (hasQuality && quality < 0.6) reasons.push("low_quality");
  if (!input.allowPackshot && !isDerivedView && PACKSHOT_KINDS.has(assetKind)) reasons.push("packshot_only");
  if (!input.allowPackshot && !isDerivedView && sourceKind === "product_twin_latest" && PACKSHOT_KINDS.has(assetKind)) {
    if (!reasons.includes("packshot_only")) reasons.push("packshot_only");
  }

  if (reasons.length) {
    return {
      ok: false,
      severity: "block",
      reasons,
      recommendation: "build or pick a derived b-roll/source view first, then submit paid video generation",
    };
  }

  if (!isDerivedView && (assetKind === "clean_png" || sourceKind === "clean_source" || sourceKind === "prepared")) {
    return {
      ok: true,
      severity: "review",
      reasons: [],
      recommendation: "safe enough for a small experiment, but derived lifestyle/detail views should be preferred for scale",
    };
  }

  return {
    ok: true,
    severity: "pass",
    reasons: [],
    recommendation: "source can enter a small paid b-roll experiment",
  };
}

export function buildProductBrollExperimentPlan(input: ProductBrollExperimentPlanInput) {
  const gate = assessProductBrollSource(input);
  const category = normalized(input.category);
  const autonomousBlocked = input.autonomous === true && (category === "apparel" || category === "bag");
  const labels = (input.variants || []).slice(0, 6).map((variant) => variant.label);
  const mode = !gate.ok || autonomousBlocked ? "blocked" : (input.submit ? "ready_to_submit" : "dry_run");
  return {
    mode,
    article: input.article,
    product: input.product || input.article,
    source: {
      kind: input.sourceKind || null,
      asset_kind: input.assetKind || null,
      quality: input.assetQuality ?? null,
      risk: input.assetRisk || null,
      view_id: input.viewId || null,
    },
    gate,
    autonomous_gate: autonomousBlocked ? {
      ok: false,
      reason: "category_too_complex",
      recommendation: "use real-photo crop/pan/zoom montage for apparel and bags before paid generative b-roll",
    } : { ok: true },
    explore: labels,
    next_actions: !gate.ok
      ? [
          "derive product views from the clean source instead of using a packshot background",
          "use a source with risk low/medium and quality >= 0.60",
          "re-run dry-run and check source_gate before paid submit",
        ]
      : autonomousBlocked
        ? [
            "hold autonomous paid generation for apparel/bag",
            "build real-photo motion montage from photoshoot frames",
            "run simple SKU lab on cosmetics or toy first",
          ]
        : [
            "submit 1 variant only",
            "archive completed job to Yandex Disk",
            "auto-judge frames before any next paid batch",
          ],
  };
}

export function assessProductBrollQuality(input: ProductBrollQualityInput) {
  const category = normalized(input.category);
  const severity = normalized(input.artifact?.severity);
  const defects = Array.isArray(input.artifact?.defects) ? input.artifact.defects : [];
  const frameCount = Number(input.frameCount || 0);
  const reasons: ProductBrollRejectReason[] = [];

  if (!input.manualOverride && (category === "apparel" || category === "bag")) reasons.push("category_too_complex");
  if (frameCount < 2) reasons.push("frames_unavailable");
  if (input.artifact?.ok === false || severity === "broken") reasons.push("artifact_detected");
  if (defects.some((defect) => /identity|changed|extra|invent|logo|label|morph|deform|искаж|лишн|артефакт|логотип|товар/i.test(defect))) {
    reasons.push("identity_drift");
  }

  const verdict: ProductBrollHumanVerdict = reasons.length
    ? "reject"
    : severity === "minor"
      ? "weak"
      : "usable";
  const score = verdict === "usable" ? 0.7 : verdict === "weak" ? 0.3 : 0;
  return {
    ok: verdict === "usable",
    verdict,
    score,
    reasons,
    defects,
    recommendation: verdict === "usable"
      ? [
          "keep this source/view/prompt family for one more small experiment",
          "do not scale until 3 clean usable clips in a row",
        ]
      : [
          "do not reuse this source/view/prompt for autonomous paid generation",
          category === "apparel" || category === "bag" ? "switch apparel/bag to real-photo motion montage" : "tighten identity prompt and retry on simple SKU",
        ],
  };
}

export function summarizeProductBrollFeedback(input: {
  verdict: ProductBrollHumanVerdict;
  reasons?: ProductBrollRejectReason[];
  score?: number | null;
  note?: string | null;
}) {
  const scoreByVerdict: Record<ProductBrollHumanVerdict, number> = {
    winner: 1,
    usable: 0.7,
    weak: 0.3,
    reject: 0,
  };
  const score = Number.isFinite(Number(input.score)) ? Math.max(0, Math.min(1, Number(input.score))) : scoreByVerdict[input.verdict];
  return {
    verdict: input.verdict,
    score,
    reasons: input.reasons || [],
    note: String(input.note || "").trim().slice(0, 240) || null,
    next_action: input.verdict === "winner" || input.verdict === "usable"
      ? "prefer similar source/view and motion pattern"
      : "avoid this source/view/motion pattern in the next experiment",
  };
}
