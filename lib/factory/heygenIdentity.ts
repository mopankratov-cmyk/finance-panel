import { createHash } from "node:crypto";
import type { HeyGenAspectRatio } from "@/lib/factory/heygen";

export type HeyGenIdentitySource = "existing_look" | "prompt_design_ai" | "upload_own_face" | "mixed";

export interface HeyGenBloggerIdentityCard {
  id?: string;
  name: string;
  source: HeyGenIdentitySource;
  avatarGroupId?: string;
  avatarLookId?: string;
  voiceId?: string;
  language?: string;
  persona?: {
    ageRange?: string;
    gender?: string;
    ethnicity?: string;
    location?: string;
    backstory?: string;
    speechStyle?: string;
  };
  prompt?: string;
  faceImageUrls?: string[];
  referenceVideoUrl?: string;
  consentConfirmed?: boolean;
  defaultAspectRatio?: HeyGenAspectRatio;
  lockedFields?: string[];
}

export interface HeyGenIdentityPlanStep {
  id: string;
  label: string;
  endpoint?: string;
  paid: boolean;
  blocked?: boolean;
  reason?: string;
}

export interface HeyGenIdentityPlan {
  ok: boolean;
  identityHash: string;
  source: HeyGenIdentitySource;
  stableCard: Required<Pick<HeyGenBloggerIdentityCard, "name" | "source">> & Omit<HeyGenBloggerIdentityCard, "name" | "source">;
  steps: HeyGenIdentityPlanStep[];
  errors: string[];
  warnings: string[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function heygenIdentityHash(card: HeyGenBloggerIdentityCard): string {
  const stable = {
    name: card.name,
    source: card.source,
    avatarGroupId: card.avatarGroupId,
    avatarLookId: card.avatarLookId,
    voiceId: card.voiceId,
    language: card.language,
    persona: card.persona,
    prompt: card.prompt,
    faceImageUrls: card.faceImageUrls,
    referenceVideoUrl: card.referenceVideoUrl,
  };
  return createHash("sha256").update(stableJson(stable)).digest("hex").slice(0, 16);
}

function compactCard(card: HeyGenBloggerIdentityCard): HeyGenIdentityPlan["stableCard"] {
  return {
    ...card,
    name: card.name.trim(),
    source: card.source,
    language: card.language || "ru-RU",
    defaultAspectRatio: card.defaultAspectRatio || "9:16",
    lockedFields: card.lockedFields && card.lockedFields.length
      ? Array.from(new Set(card.lockedFields))
      : ["name", "source", "avatarLookId", "voiceId", "persona.speechStyle"],
  };
}

export function buildHeyGenIdentityPlan(card: HeyGenBloggerIdentityCard): HeyGenIdentityPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps: HeyGenIdentityPlanStep[] = [];

  if (!card.name || card.name.trim().length < 2) errors.push("name is required");
  if (!card.source) errors.push("source is required");
  if (!card.voiceId) warnings.push("voiceId is not selected yet; video generation must stay blocked");

  if (card.source === "existing_look") {
    if (!card.avatarLookId) errors.push("existing_look requires avatarLookId");
    steps.push({
      id: "bind-existing-look",
      label: "Bind existing HeyGen look and voice as stable blogger identity",
      endpoint: "GET /v3/avatars/looks/{look_id}",
      paid: false,
    });
  }

  if (card.source === "prompt_design_ai") {
    if (!card.prompt && !card.persona?.backstory) warnings.push("prompt identity needs visual prompt or persona backstory");
    steps.push({
      id: "create-prompt-avatar",
      label: "Create prompt-designed avatar",
      endpoint: "POST /v3/avatars",
      paid: true,
      blocked: true,
      reason: "requires explicit owner confirmation before avatar creation/training",
    });
  }

  if (card.source === "upload_own_face" || card.source === "mixed") {
    if (!card.consentConfirmed) errors.push("consentConfirmed=true is required for any uploaded face/reference");
    if (!card.faceImageUrls?.length && !card.referenceVideoUrl) errors.push(`${card.source} requires faceImageUrls or referenceVideoUrl`);
    steps.push({
      id: "create-upload-avatar",
      label: "Create avatar from owner-approved face/reference media",
      endpoint: "POST /v3/avatars",
      paid: true,
      blocked: true,
      reason: "requires consentConfirmed and explicit owner confirmation before upload/training",
    });
  }

  if (card.avatarLookId && card.voiceId) {
    steps.push({
      id: "ready-for-smoke-video",
      label: "Ready for a 3-4 second manual smoke render",
      endpoint: "POST /v3/videos",
      paid: true,
      blocked: true,
      reason: "video render requires explicit owner confirmation and budget guard",
    });
  }

  const stableCard = compactCard(card);
  return {
    ok: errors.length === 0,
    identityHash: heygenIdentityHash(stableCard),
    source: stableCard.source,
    stableCard,
    steps,
    errors,
    warnings,
  };
}

export function canUseHeyGenIdentityForVideo(card: HeyGenBloggerIdentityCard): { ok: boolean; reason?: string } {
  const plan = buildHeyGenIdentityPlan(card);
  if (!plan.ok) return { ok: false, reason: plan.errors[0] };
  if (!card.avatarLookId) return { ok: false, reason: "avatarLookId is required" };
  if (!card.voiceId) return { ok: false, reason: "voiceId is required" };
  return { ok: true };
}

