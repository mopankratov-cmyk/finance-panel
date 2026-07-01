export type ProductBrollHumanVerdict = "winner" | "usable" | "weak" | "reject";

export type ProductBrollRejectReason =
  | "wrong_source"
  | "packshot_only"
  | "risk_high"
  | "low_quality"
  | "identity_drift"
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
  recipe?: string;
  model?: string;
  variants?: { id: string; label: string }[];
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
  const labels = (input.variants || []).slice(0, 6).map((variant) => variant.label);
  const mode = gate.ok ? (input.submit ? "ready_to_submit" : "dry_run") : "blocked";
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
    explore: labels,
    next_actions: gate.ok
      ? [
          "submit 1-2 variants only",
          "archive completed jobs to Yandex Disk",
          "mark each result as winner, usable, weak, or reject before the next batch",
        ]
      : [
          "derive product views from the clean source instead of using a packshot background",
          "use a source with risk low/medium and quality >= 0.60",
          "re-run dry-run and check source_gate before paid submit",
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
