import { buildBRollSpec, type BRollSpec } from "@/lib/factory/brollSpec";

export type UgcBloggerRole = "primary_creator" | "mom_review" | "dad_review";
export type UgcStoryboardClipKind = "hook_talking_head" | "proof_broll" | "detail_broll" | "cta_overlay";

export interface UgcStoryboardBlogger {
  id: string;
  name: string;
  role: UgcBloggerRole;
  avatarLookId: string;
  voiceId?: string;
}

export interface UgcProofCue {
  claim: string;
  shot: string;
  evidence: "hands" | "packaging" | "detail" | "usage" | "comparison";
}

export interface UgcStoryboardInput {
  blogger: UgcStoryboardBlogger;
  hook: string;
  product?: string;
  angle?: string;
  proofCues?: UgcProofCue[];
  faceDurationSec?: number;
  brollDurationSec?: number;
  cta?: string;
}

export interface UgcStoryboardClip {
  id: string;
  kind: UgcStoryboardClipKind;
  startSec: number;
  durationSec: number;
  text?: string;
  avatarLookId?: string;
  shot?: string;
  evidence?: UgcProofCue["evidence"];
  brollSpec?: BRollSpec;
  notes: string[];
}

export interface UgcStoryboard {
  ok: boolean;
  mode: "detached-storyboard-dry-run";
  blogger: UgcStoryboardBlogger;
  product: string;
  totalDurationSec: number;
  clips: UgcStoryboardClip[];
  proofCues: UgcProofCue[];
  errors: string[];
  warnings: string[];
  nextProviderActions: string[];
}

export const RUSSIAN_HEYGEN_BLOGGERS: Record<"katya" | "alina" | "sergey" | "manya" | "vika" | "olya", UgcStoryboardBlogger> = {
  katya: {
    id: "katya_russian_creator_v3b",
    name: "Катя",
    role: "primary_creator",
    avatarLookId: "f9e4ecf1b902451aaa17e8c2430a5c1b",
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  },
  alina: {
    id: "alina_russian_mom_v3b",
    name: "Алина",
    role: "mom_review",
    avatarLookId: "8dd0451ca8af4d25b5222014d3f0657f",
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  },
  sergey: {
    id: "sergey_russian_dad_v3b",
    name: "Сергей",
    role: "dad_review",
    avatarLookId: "a5e9b0c485a749518e577ce392318366",
  },
  // Поколение face-foundry 2026-07-02: собственные лица (FAL) + обученные HeyGen-группы;
  // полные паспорта (group_id, все 14 look_id на каждую) — docs/factory-blogger-passports.json
  manya: {
    id: "manya_ugc_wb_v1",
    name: "Маня",
    role: "primary_creator",
    avatarLookId: "f3d97943d5854f28bda126ad03f02bab", // look__manya__10__car_close
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  },
  vika: {
    id: "vika_ugc_wb_v1",
    name: "Вика",
    role: "primary_creator",
    avatarLookId: "96171867fa664fb18b5f257f84c0f63a", // look__vika__10__car_close
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  },
  olya: {
    id: "olya_ugc_wb_v1",
    name: "Оля",
    role: "mom_review",
    avatarLookId: "6359cf4afc1849d798fdfa4e0873f27a", // look__olya__05__mirror_close
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  },
};

function clean(value: unknown, max = 220): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function inferProofCues(hook: string, product: string): UgcProofCue[] {
  const t = hook.toLowerCase();
  if (/(удобн|разбират|понятн|работа)/i.test(t)) {
    return [{
      claim: "удобно и понятно",
      shot: `показать ${product}: руки открывают, берут деталь и делают одно простое действие`,
      evidence: "usage",
    }];
  }
  if (/(ерунд|реклам|сомнев|не собира)/i.test(t)) {
    return [{
      claim: "сомнение сменилось интересом",
      shot: `показать ${product} крупно без фильтров: материал, упаковка, реальный размер`,
      evidence: "detail",
    }];
  }
  return [{
    claim: "это стоит посмотреть ближе",
    shot: `показать ${product} в руках и один честный крупный план`,
    evidence: "hands",
  }];
}

function normalizeProofCues(input: UgcProofCue[] | undefined, hook: string, product: string): UgcProofCue[] {
  const cues = (input || []).slice(0, 4).map((cue) => ({
    claim: clean(cue.claim, 120),
    shot: clean(cue.shot, 220),
    evidence: cue.evidence,
  })).filter((cue) => cue.claim && cue.shot && ["hands", "packaging", "detail", "usage", "comparison"].includes(cue.evidence));
  return cues.length ? cues : inferProofCues(hook, product);
}

export function buildDetachedUgcStoryboard(input: UgcStoryboardInput): UgcStoryboard {
  const errors: string[] = [];
  const warnings: string[] = [];
  const blogger = input.blogger;
  const hook = clean(input.hook, 180);
  const product = clean(input.product, 120) || "товар";

  if (!blogger?.avatarLookId) errors.push("blogger.avatarLookId is required");
  if (!hook) errors.push("hook is required");

  const requestedFaceDuration = Number(input.faceDurationSec);
  if (Number.isFinite(requestedFaceDuration) && requestedFaceDuration > 4) {
    warnings.push("faceDurationSec was clamped to 4s; keep AI talking-head short");
  }
  const faceDurationSec = clamp(input.faceDurationSec, 3, 2, 4);
  const brollDurationSec = clamp(input.brollDurationSec, 4, 3, 7);
  const proofCues = normalizeProofCues(input.proofCues, hook, product);

  const clips: UgcStoryboardClip[] = [{
    id: "clip_01_hook_face",
    kind: "hook_talking_head",
    startSec: 0,
    durationSec: faceDurationSec,
    text: hook,
    avatarLookId: blogger.avatarLookId,
    notes: [
      "HeyGen talking-head only",
      "do not show product here",
      "cut away before avatar starts feeling artificial",
    ],
  }];

  let cursor = faceDurationSec;
  proofCues.forEach((cue, idx) => {
    clips.push({
      id: `clip_${String(idx + 2).padStart(2, "0")}_proof_broll`,
      kind: idx === 0 ? "proof_broll" : "detail_broll",
      startSec: cursor,
      durationSec: brollDurationSec,
      text: cue.claim,
      shot: cue.shot,
      evidence: cue.evidence,
      brollSpec: buildBRollSpec({
        phrase: cue.claim,
        kicker: input.angle || product,
        durationSec: Math.min(4, brollDurationSec),
      }, idx),
      notes: [
        "must visually prove the spoken claim",
        "prefer hands/product/detail over generated face",
        "no stock-looking filler",
      ],
    });
    cursor += brollDurationSec;
  });

  const cta = clean(input.cta, 120);
  if (cta) {
    clips.push({
      id: "clip_cta_overlay",
      kind: "cta_overlay",
      startSec: cursor,
      durationSec: 2,
      text: cta,
      brollSpec: buildBRollSpec({ phrase: cta, preset: "quote", kicker: product, durationSec: 2 }, proofCues.length),
      notes: ["CTA as overlay, not another talking-head segment"],
    });
    cursor += 2;
  }

  const faceTime = clips.filter((clip) => clip.kind === "hook_talking_head").reduce((sum, clip) => sum + clip.durationSec, 0);
  if (faceTime > 4) errors.push("talking-head face time must be <= 4s");
  if (!clips.some((clip) => clip.kind === "proof_broll")) errors.push("storyboard requires at least one proof_broll clip");
  if (proofCues.some((cue) => !clips.some((clip) => clip.text === cue.claim && clip.shot))) {
    errors.push("every proof cue must map to a visual clip");
  }

  return {
    ok: errors.length === 0,
    mode: "detached-storyboard-dry-run",
    blogger,
    product,
    totalDurationSec: Number(cursor.toFixed(2)),
    clips,
    proofCues,
    errors,
    warnings,
    nextProviderActions: [
      "render hook_talking_head in HeyGen only for the first 2-4 seconds",
      "render proof_broll from product twin/FAL/real footage after face segment",
      "compose clips only after manual face QC and proof-frame QC pass",
    ],
  };
}
