import { hasGenericOpener } from "./genericOpeners";

export type HookSource = "human" | "strong_prompt" | "generated" | "unknown";

export interface HookPolicyInput {
  text?: unknown;
  source?: unknown;
  locked?: unknown;
  product?: unknown;
}

export interface HookPolicyResult {
  ok: boolean;
  score: number;
  source: HookSource;
  locked: boolean;
  action: "pass" | "warn" | "reject";
  issues: string[];
}

function clean(value: unknown, max = 300): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceOf(value: unknown): HookSource {
  if (value === "human" || value === "strong_prompt" || value === "generated") return value;
  return "unknown";
}

export function evaluateHookPolicy(input: HookPolicyInput): HookPolicyResult {
  const text = clean(input.text);
  const lower = text.toLowerCase();
  const issues: string[] = [];
  let score = 5;

  if (!text) {
    issues.push("empty_hook");
    score -= 4;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 14) {
    issues.push("too_long");
    score -= 1;
  }
  if (hasGenericOpener(lower)) {
    issues.push("generic_ad_opening");
    score -= 2;
  }
  if (!/[?!]/.test(text) && !/\b(не|почему|как|что|без|пока|если|ошибка|секрет|правда)\b/i.test(text)) {
    issues.push("no_tension_or_question");
    score -= 1;
  }
  if (!/[0-9]/.test(text) && !/\b(за|через|до|после|вместо|против|минус|плюс)\b/i.test(text)) {
    issues.push("low_specificity");
    score -= 1;
  }
  if (input.locked !== true) {
    issues.push("hook_not_locked");
    score -= 1;
  }

  score = Math.max(1, Math.min(5, score));
  const action = score <= 2 ? "reject" : score === 3 ? "warn" : "pass";
  return {
    ok: action !== "reject",
    score,
    source: sourceOf(input.source),
    locked: input.locked === true,
    action,
    issues,
  };
}
