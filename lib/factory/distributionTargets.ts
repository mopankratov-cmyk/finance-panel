export type ProxyKind = "residential" | "mobile" | "isp";
export type WarmupStage = "cold" | "warming" | "warm" | "active" | "cooling" | "banned";
export type HealthState = "green" | "flagged" | "captcha" | "banned";
export type ComplianceStatus = "unknown" | "pending" | "approved" | "blocked" | "rejected";

export interface DistributionTargetComplianceMetadata {
  is_self_promo: boolean | null;
  erid: string | null;
  ord_operator: string | null;
  advertiser_inn: string | null;
  compliance_status: ComplianceStatus | null;
}

export interface DistributionTargetFleetConfig extends DistributionTargetComplianceMetadata {
  proxy_sid: string | null;
  profile_id: string | null;
  proxy_kind: ProxyKind | null;
  warmup_stage: WarmupStage | null;
  warmup_started_at: string | null;
  warmup_days_done: number | null;
  session_valid: boolean | null;
  health_state: HealthState | null;
  ban_evidence: string | null;
  daily_cap: number | null;
  posts_today: number | null;
  last_post_at: string | null;
  worker_box_id: string | null;
}

export type DistributionTargetConfigPatch = Partial<DistributionTargetFleetConfig>;

const PROXY_KINDS = new Set<ProxyKind>(["residential", "mobile", "isp"]);
const WARMUP_STAGES = new Set<WarmupStage>(["cold", "warming", "warm", "active", "cooling", "banned"]);
const HEALTH_STATES = new Set<HealthState>(["green", "flagged", "captcha", "banned"]);
const COMPLIANCE_STATUSES = new Set<ComplianceStatus>(["unknown", "pending", "approved", "blocked", "rejected"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function text(value: unknown, max = 240): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function bool(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return null;
}

function int(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>): T | null {
  const cleaned = text(value, 40)?.toLowerCase() as T | null;
  return cleaned && allowed.has(cleaned) ? cleaned : null;
}

export function readDistributionTargetConfig(value: unknown): DistributionTargetFleetConfig {
  const row = asRecord(value);
  return {
    proxy_sid: text(row.proxy_sid, 120),
    profile_id: text(row.profile_id, 120),
    proxy_kind: enumValue(row.proxy_kind, PROXY_KINDS),
    warmup_stage: enumValue(row.warmup_stage, WARMUP_STAGES),
    warmup_started_at: text(row.warmup_started_at, 80),
    warmup_days_done: int(row.warmup_days_done),
    session_valid: bool(row.session_valid),
    health_state: enumValue(row.health_state, HEALTH_STATES),
    ban_evidence: text(row.ban_evidence, 500),
    daily_cap: int(row.daily_cap),
    posts_today: int(row.posts_today),
    last_post_at: text(row.last_post_at, 80),
    worker_box_id: text(row.worker_box_id, 120),
    is_self_promo: bool(row.is_self_promo),
    erid: text(row.erid, 120),
    ord_operator: text(row.ord_operator, 120),
    advertiser_inn: text(row.advertiser_inn, 32),
    compliance_status: enumValue(row.compliance_status, COMPLIANCE_STATUSES),
  };
}

export function readComplianceMetadata(value: unknown): DistributionTargetComplianceMetadata {
  const config = readDistributionTargetConfig(value);
  return {
    is_self_promo: config.is_self_promo,
    erid: config.erid,
    ord_operator: config.ord_operator,
    advertiser_inn: config.advertiser_inn,
    compliance_status: config.compliance_status,
  };
}

export function mergeDistributionTargetConfig(current: unknown, patch: DistributionTargetConfigPatch): Record<string, unknown> {
  const base = asRecord(current);
  const existing = readDistributionTargetConfig(base);
  const next = readDistributionTargetConfig({ ...base, ...patch });

  if (existing.proxy_sid && next.proxy_sid && existing.proxy_sid !== next.proxy_sid) {
    throw new Error("proxy_sid is immutable once assigned");
  }
  if (existing.profile_id && next.profile_id && existing.profile_id !== next.profile_id) {
    throw new Error("profile_id is immutable once assigned");
  }

  return {
    ...base,
    ...next,
  };
}
