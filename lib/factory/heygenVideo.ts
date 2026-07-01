import { buildHeyGenCreateVideoDryRun, type HeyGenDryRun } from "@/lib/factory/heygen";
import {
  buildHeyGenIdentityPlan,
  canUseHeyGenIdentityForVideo,
  heygenIdentityHash,
  type HeyGenBloggerIdentityCard,
} from "@/lib/factory/heygenIdentity";

export type HeyGenRealismMode = "phone_selfie" | "casual_room" | "clean_studio";

export interface HeyGenSmokeVideoInput {
  identity: HeyGenBloggerIdentityCard;
  script: string;
  title?: string;
  realismMode?: HeyGenRealismMode;
  emotionalBeat?: "curious" | "skeptical" | "surprised" | "warm_recommendation";
  speechSpeed?: "slow" | "normal" | "fast";
}

export interface HeyGenSmokeVideoPlan {
  ok: boolean;
  identityHash: string;
  mode: "manual-smoke-plan-only";
  paidBlocked: true;
  dryRun?: HeyGenDryRun;
  script: string;
  realismDirectives: string[];
  errors: string[];
  warnings: string[];
}

const AD_STYLE_PATTERNS = [
  /innovative/i,
  /best[- ]?in[- ]?class/i,
  /unique offer/i,
  /buy now/i,
  /limited time/i,
  /revolutionary/i,
  /must[- ]?have/i,
  /идеальн/i,
  /инновационн/i,
  /уникальн/i,
  /покупайте/i,
  /лучшее предложение/i,
];

const SCRIPT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/This innovative product/gi, "I did not plan to try this"],
  [/Buy now/gi, "I would check it out"],
  [/Это инновационный продукт/gi, "Я вообще не собиралась это брать"],
  [/Покупайте сейчас/gi, "Я бы присмотрелась"],
  [/Уникальное предложение/gi, "Мне стало интересно"],
];

export function detectAdStyle(script: string): string[] {
  return AD_STYLE_PATTERNS.filter((pattern) => pattern.test(script)).map((pattern) => pattern.source);
}

export function softenAdStyle(script: string): string {
  let out = script.trim().replace(/\s+/g, " ");
  for (const [pattern, replacement] of SCRIPT_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

function realismDirectives(mode: HeyGenRealismMode, beat: HeyGenSmokeVideoInput["emotionalBeat"], speed: HeyGenSmokeVideoInput["speechSpeed"]): string[] {
  const directives = [
    "natural UGC delivery, no presenter voice",
    "tiny imperfections are allowed: micro-pauses, relaxed mouth movement, normal breathing",
    "do not over-smile in the first two seconds",
  ];
  if (mode === "phone_selfie") directives.push("front phone camera feel, casual framing, non-perfect light");
  if (mode === "casual_room") directives.push("ordinary room, soft domestic light, creator speaks like a friend");
  if (mode === "clean_studio") directives.push("clean background but still conversational, not commercial");
  if (beat) directives.push(`emotional beat: ${beat}`);
  if (speed) directives.push(`speech speed: ${speed}`);
  return directives;
}

export function buildHeyGenSmokeVideoPlan(input: HeyGenSmokeVideoInput): HeyGenSmokeVideoPlan {
  const identityPlan = buildHeyGenIdentityPlan(input.identity);
  const readiness = canUseHeyGenIdentityForVideo(input.identity);
  const warnings = [...identityPlan.warnings];
  const errors = [...identityPlan.errors];
  if (!readiness.ok && readiness.reason) errors.push(readiness.reason);

  const adMatches = detectAdStyle(input.script);
  if (adMatches.length) warnings.push("script has ad-style markers; softened script should be reviewed");

  const script = softenAdStyle(input.script);
  if (!script || script.length < 8) errors.push("script is too short for a useful smoke render");
  if (script.length > 420) warnings.push("smoke script is long; keep first-face test near 3-4 seconds");

  const identityHash = heygenIdentityHash(input.identity);
  const directives = realismDirectives(
    input.realismMode || "phone_selfie",
    input.emotionalBeat || "curious",
    input.speechSpeed || "normal",
  );

  const dryRun = readiness.ok && input.identity.avatarLookId && input.identity.voiceId
    ? buildHeyGenCreateVideoDryRun({
      title: input.title || `ugc-smoke-${identityHash}`,
      avatarLookId: input.identity.avatarLookId,
      voiceId: input.identity.voiceId,
      script: `${script}\n\nDelivery notes: ${directives.join("; ")}.`,
      aspectRatio: input.identity.defaultAspectRatio || "9:16",
      engine: "avatar_iv",
    })
    : undefined;

  return {
    ok: errors.length === 0,
    identityHash,
    mode: "manual-smoke-plan-only",
    paidBlocked: true,
    dryRun,
    script,
    realismDirectives: directives,
    errors,
    warnings,
  };
}

