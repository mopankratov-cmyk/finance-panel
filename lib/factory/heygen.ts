import { extractJson } from "@/lib/factory/extractJson";

const BASE = "https://api.heygen.com";
const DEFAULT_TIMEOUT_MS = 20000;

export type HeyGenOwnership = "public" | "private";
export type HeyGenAvatarType = "photo_avatar" | "studio_avatar" | "digital_twin";
export type HeyGenAspectRatio = "16:9" | "9:16" | "1:1";
export type HeyGenVideoEngine = "avatar_iv" | "avatar_v" | "avatar_iii";

export interface HeyGenApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  raw?: unknown;
}

export interface HeyGenAvatarGroup {
  id: string;
  name: string;
  gender?: string;
  looks_count?: number;
  preview_image_url?: string;
  preview_video_url?: string;
  default_voice_id?: string;
  consent_status?: string;
  status?: string;
}

export interface HeyGenAvatarLook {
  id: string;
  group_id?: string;
  name: string;
  avatar_type?: HeyGenAvatarType | string;
  status?: string;
  preferred_orientation?: string;
  preview_image_url?: string;
  preview_video_url?: string;
  supported_api_engines?: string[];
  default_voice_id?: string;
  image_width?: number;
  image_height?: number;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  support_pause?: boolean;
  support_locale?: boolean;
  preview_audio_url?: string;
}

export interface HeyGenCreateAvatarInput {
  name: string;
  avatarType: "photo" | "digital_twin" | "prompt";
  imageUrl?: string;
  videoUrl?: string;
  prompt?: string;
  groupName?: string;
}

export interface HeyGenCreateVideoInput {
  title?: string;
  avatarLookId: string;
  voiceId: string;
  script: string;
  aspectRatio?: HeyGenAspectRatio;
  engine?: HeyGenVideoEngine;
  background?: { value?: string; url?: string; asset_id?: string };
  removeBackground?: boolean;
  callbackUrl?: string;
}

export interface HeyGenDryRun<TBody extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  endpoint: string;
  method: "POST";
  paid: boolean;
  body: TBody;
  warnings: string[];
}

export interface HeyGenBlockedResult<TBody extends Record<string, unknown> = Record<string, unknown>> {
  ok: false;
  status: 0;
  blocked: true;
  reason: string;
  dryRun: HeyGenDryRun<TBody>;
}

function headers(): Record<string, string> | null {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) return null;
  return { "x-api-key": key, "Content-Type": "application/json" };
}

export function heygenReady(): boolean {
  return !!process.env.HEYGEN_API_KEY;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function cleanUrl(value: unknown): string | undefined {
  const url = str(value);
  if (!url) return undefined;
  return url.split("?")[0];
}

function listFromPayload<T>(payload: unknown, normalize: (item: unknown) => T | null): T[] {
  const root = asRecord(payload);
  const arr = Array.isArray(payload) ? payload
    : Array.isArray(root?.data) ? root.data
    : Array.isArray(root?.results) ? root.results
    : [];
  return arr.map(normalize).filter((item): item is T => !!item);
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qp.set(key, String(value));
  }
  const out = qp.toString();
  return out ? `?${out}` : "";
}

async function heygenRequest<T>(path: string, init?: RequestInit): Promise<HeyGenApiResult<T>> {
  const h = headers();
  if (!h) return { ok: false, status: 0, data: null, error: "HEYGEN_API_KEY не настроен" };
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...h, ...(init?.headers || {}) },
      cache: "no-store",
      signal: init?.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await r.text();
    const parsed = extractJson(text);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        data: null,
        error: `heygen ${r.status}: ${text.slice(0, 180)}`,
        raw: parsed ?? text.slice(0, 300),
      };
    }
    return { ok: true, status: r.status, data: parsed as T, raw: parsed };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e as Error)?.message || e).slice(0, 180) };
  }
}

function normalizeAvatarGroup(item: unknown): HeyGenAvatarGroup | null {
  const r = asRecord(item);
  const id = str(r?.id);
  if (!r || !id) return null;
  return {
    id,
    name: str(r.name) || "HeyGen avatar",
    gender: str(r.gender),
    looks_count: num(r.looks_count),
    preview_image_url: cleanUrl(r.preview_image_url),
    preview_video_url: cleanUrl(r.preview_video_url),
    default_voice_id: str(r.default_voice_id),
    consent_status: str(r.consent_status),
    status: str(r.status),
  };
}

function normalizeAvatarLook(item: unknown): HeyGenAvatarLook | null {
  const r = asRecord(item);
  const id = str(r?.id);
  if (!r || !id) return null;
  return {
    id,
    group_id: str(r.group_id),
    name: str(r.name) || "HeyGen look",
    avatar_type: str(r.avatar_type),
    status: str(r.status),
    preferred_orientation: str(r.preferred_orientation),
    preview_image_url: cleanUrl(r.preview_image_url),
    preview_video_url: cleanUrl(r.preview_video_url),
    supported_api_engines: Array.isArray(r.supported_api_engines) ? r.supported_api_engines.filter((x): x is string => typeof x === "string") : undefined,
    default_voice_id: str(r.default_voice_id),
    image_width: num(r.image_width),
    image_height: num(r.image_height),
  };
}

function normalizeVoice(item: unknown): HeyGenVoice | null {
  const r = asRecord(item);
  const voiceId = str(r?.voice_id);
  if (!r || !voiceId) return null;
  return {
    voice_id: voiceId,
    name: str(r.name) || "HeyGen voice",
    language: str(r.language),
    gender: str(r.gender),
    support_pause: bool(r.support_pause),
    support_locale: bool(r.support_locale),
    preview_audio_url: cleanUrl(r.preview_audio_url),
  };
}

export async function heygenListAvatarGroups(opts: { limit?: number; ownership?: HeyGenOwnership } = {}): Promise<HeyGenApiResult<HeyGenAvatarGroup[]>> {
  const query = buildQuery({ limit: opts.limit, ownership: opts.ownership });
  const res = await heygenRequest<unknown>(`/v3/avatars${query}`);
  return { ...res, data: res.data ? listFromPayload(res.data, normalizeAvatarGroup) : null };
}

export async function heygenListAvatarLooks(opts: { limit?: number; token?: string; groupId?: string; ownership?: HeyGenOwnership; avatarType?: HeyGenAvatarType; search?: string } = {}): Promise<HeyGenApiResult<HeyGenAvatarLook[]>> {
  const query = buildQuery({
    limit: opts.limit,
    token: opts.token,
    group_id: opts.groupId,
    ownership: opts.ownership,
    avatar_type: opts.avatarType,
    search: opts.search,
  });
  const res = await heygenRequest<unknown>(`/v3/avatars/looks${query}`);
  return { ...res, data: res.data ? listFromPayload(res.data, normalizeAvatarLook) : null };
}

export async function heygenListVoices(opts: { limit?: number; token?: string; language?: string; gender?: string; engine?: string; type?: string } = {}): Promise<HeyGenApiResult<HeyGenVoice[]>> {
  const query = buildQuery({
    limit: opts.limit,
    token: opts.token,
    language: opts.language,
    gender: opts.gender,
    engine: opts.engine,
    type: opts.type,
  });
  const res = await heygenRequest<unknown>(`/v3/voices${query}`);
  return { ...res, data: res.data ? listFromPayload(res.data, normalizeVoice) : null };
}

export function buildHeyGenCreateAvatarDryRun(input: HeyGenCreateAvatarInput): HeyGenDryRun {
  const body: Record<string, unknown> = {
    name: input.name,
    avatar_type: input.avatarType,
  };
  if (input.groupName) body.group_name = input.groupName;
  if (input.imageUrl) body.image = { type: "url", url: input.imageUrl };
  if (input.videoUrl) body.video = { type: "url", url: input.videoUrl };
  if (input.prompt) body.prompt = input.prompt;
  const warnings: string[] = [];
  if (input.avatarType === "photo" && !input.imageUrl) warnings.push("photo avatar requires imageUrl");
  if (input.avatarType === "digital_twin" && !input.videoUrl) warnings.push("digital twin requires videoUrl and consent/training");
  if (input.avatarType === "prompt" && !input.prompt) warnings.push("prompt avatar requires prompt");
  return { ok: true, endpoint: "/v3/avatars", method: "POST", paid: true, body, warnings };
}

export async function heygenCreateAvatar(input: HeyGenCreateAvatarInput & { confirmCreate?: boolean }): Promise<HeyGenApiResult<Record<string, unknown>> | HeyGenBlockedResult> {
  const dryRun = buildHeyGenCreateAvatarDryRun(input);
  if (!input.confirmCreate) {
    return { ok: false, status: 0, blocked: true, reason: "avatar creation is disabled unless confirmCreate=true", dryRun };
  }
  return heygenRequest<Record<string, unknown>>(dryRun.endpoint, { method: "POST", body: JSON.stringify(dryRun.body) });
}

export function buildHeyGenCreateVideoDryRun(input: HeyGenCreateVideoInput): HeyGenDryRun {
  const warnings: string[] = [];
  if (!input.avatarLookId) warnings.push("avatarLookId is required; use /v3/avatars/looks id, not avatar group id");
  if (!input.voiceId) warnings.push("voiceId is required");
  if (!input.script || input.script.trim().length < 2) warnings.push("script is empty");
  if (/group/i.test(input.avatarLookId)) warnings.push("avatarLookId looks like a group id; video generation requires a look id");

  const body: Record<string, unknown> = {
    type: "avatar",
    avatar_id: input.avatarLookId,
    title: input.title || "ugc-factory-heygen-test",
    aspect_ratio: input.aspectRatio || "9:16",
    engine: input.engine || "avatar_iv",
    script: {
      type: "text",
      input: input.script,
      voice_id: input.voiceId,
    },
  };
  if (input.background) body.background = input.background;
  if (typeof input.removeBackground === "boolean") body.remove_background = input.removeBackground;
  if (input.callbackUrl) body.callback_url = input.callbackUrl;
  return { ok: true, endpoint: "/v3/videos", method: "POST", paid: true, body, warnings };
}

export async function heygenCreateVideo(input: HeyGenCreateVideoInput & { confirmPaid?: boolean }): Promise<HeyGenApiResult<Record<string, unknown>> | HeyGenBlockedResult> {
  const dryRun = buildHeyGenCreateVideoDryRun(input);
  if (!input.confirmPaid) {
    return { ok: false, status: 0, blocked: true, reason: "paid HeyGen video generation is disabled unless confirmPaid=true", dryRun };
  }
  return heygenRequest<Record<string, unknown>>(dryRun.endpoint, { method: "POST", body: JSON.stringify(dryRun.body) });
}

export function sanitizeHeyGenVideoStatus(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) || {};
  const data = asRecord(root.data) || root;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/(video_url|thumbnail_url|gif_url|preview_.*url)$/i.test(key)) {
      out[key] = typeof value === "string" && value ? cleanUrl(value) : value;
      out[`${key}_present`] = !!value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function heygenGetVideoStatus(videoId: string): Promise<HeyGenApiResult<Record<string, unknown>>> {
  const safeVideoId = encodeURIComponent(videoId);
  const res = await heygenRequest<unknown>(`/v3/videos/${safeVideoId}`);
  return { ...res, data: res.data ? sanitizeHeyGenVideoStatus(res.data) : null };
}

