export type Transport = "api" | "browser";

export interface PublishTarget {
  target_id: string;
  platform: string;
  account_ref: string;
  mode: "organic" | "paid" | "manual";
  proxy_sid?: string;
  profile_id?: string;
  config: Record<string, unknown>;
}

export interface PublishMedia {
  recipe_id: number;
  article: string | null;
  video_path_or_url: string;
  cover_path?: string;
}

export interface PublishMeta {
  caption: string;
  hashtags?: string[];
  articles?: string[];
  ad_token?: string | null;
}

export type PublishResult =
  | { ok: true; external_post_id: string; published_url: string; pending_moderation?: boolean }
  | { ok: false; failure: FailureKind; detail: string };

export type FailureKind =
  | "needs_manual_login"
  | "captcha"
  | "session_dead"
  | "rate_limited"
  | "moderation_reject"
  | "banned"
  | "upload_failed"
  | "selector_missing"
  | "unknown";

export interface MetricSnapshot {
  views: number;
  watch_rate?: number | null;
  completion_rate?: number | null;
  saves?: number | null;
  engagement_count?: number | null;
  marketplace_orders?: number | null;
  revenue?: number | null;
  raw?: unknown;
}

export interface ChannelAdapter {
  platform: string;
  transport: Transport;
  capabilities: {
    publish: boolean;
    metrics: boolean;
    authCheck: boolean;
  };

  /** authSession is a first-class status check, not an exceptional control flow path. */
  authSession(target: PublishTarget): Promise<"OK" | "NEEDS_MANUAL_LOGIN" | "CAPTCHA">;

  /** publish may return pending_moderation when the platform accepts the upload before final review. */
  publish(media: PublishMedia, meta: PublishMeta, target: PublishTarget): Promise<PublishResult>;

  pullMetrics(externalPostId: string, target: PublishTarget): Promise<MetricSnapshot | null>;
}
