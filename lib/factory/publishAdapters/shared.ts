import { readDistributionTargetConfig } from "../distributionTargets";
import type { PublishTarget } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function sanitizePublishTarget(row: unknown): PublishTarget {
  const rec = asRecord(row);
  return {
    target_id: text(rec.id, 120) || "",
    platform: text(rec.platform, 80) || "",
    account_ref: text(rec.account_ref, 240) || "",
    mode: (text(rec.mode, 40) || "organic") as PublishTarget["mode"],
    config: asRecord(rec.config),
    proxy_sid: readDistributionTargetConfig(rec.config).proxy_sid || undefined,
    profile_id: readDistributionTargetConfig(rec.config).profile_id || undefined,
  };
}

export function configText(config: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(config[key], 1200);
    if (value) return value;
  }
  return null;
}

export function configEnv(config: Record<string, unknown>, ...keys: string[]): string | null {
  const ref = configText(config, ...keys);
  if (!ref) return null;
  if (ref.startsWith("env:")) return text(process.env[ref.slice(4)], 4000);
  const envValue = process.env[ref];
  return text(envValue, 4000) || ref;
}

export function buildCaption(meta: { caption?: string; hashtags?: string[] }): string {
  const caption = text(meta.caption, 500) || "";
  const hashtags = Array.isArray(meta.hashtags)
    ? meta.hashtags.map((tag) => text(tag, 80)).filter(Boolean).map((tag) => tag!.startsWith("#") ? tag! : `#${tag}`)
    : [];
  return [caption, hashtags.join(" ")].filter(Boolean).join("\n\n").slice(0, 800);
}
