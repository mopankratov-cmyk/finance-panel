import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const CANONICAL_FRAME_WIDTH = 720;
export const CANONICAL_FRAME_HEIGHT = 1280;
export const CANONICAL_PREP_VERSION = "source-prep-letterbox-v1";

type Db = SupabaseClient<any, "public", any>;

export interface CanonicalFrameMeta {
  canonical: true;
  prep_version: string;
  output_w: number;
  output_h: number;
  aspect: "9:16";
  letterboxed: true;
}

export function canonicalFrameMeta(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(extra || {}),
    canonical: true,
    prep_version: CANONICAL_PREP_VERSION,
    output_w: CANONICAL_FRAME_WIDTH,
    output_h: CANONICAL_FRAME_HEIGHT,
    aspect: "9:16",
    letterboxed: true,
  };
}

export async function normalizeToOutputRes(
  buf: Buffer,
  w = CANONICAL_FRAME_WIDTH,
  h = CANONICAL_FRAME_HEIGHT,
): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize(w, h, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

export async function resolveCanonicalFrame(db: Db, article: string): Promise<string | null> {
  const sku = String(article || "").trim();
  if (!sku) return null;
  try {
    const { data } = await db
      .from("content_assets")
      .select("url,analysis,created_at")
      .eq("article", sku)
      .eq("disk", "prepared")
      .eq("kind", "image")
      .contains("analysis", { canonical: true, prep_version: CANONICAL_PREP_VERSION })
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data as { url?: string | null }[] | null)?.[0];
    const url = String(row?.url || "").trim();
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function hasCanonicalFrame(db: Db, article: string): Promise<boolean> {
  return !!(await resolveCanonicalFrame(db, article));
}

export async function shouldMarkCanonical(db: Db, article: string): Promise<boolean> {
  return !(await hasCanonicalFrame(db, article));
}
