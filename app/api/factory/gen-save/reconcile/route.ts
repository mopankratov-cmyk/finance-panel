import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "factory-media";
const PREFIXES = ["gen", "renders"];

type StorageItem = {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

function isVideoName(name: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(name);
}

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function listPrefix(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
    const items = ((data || []) as StorageItem[]).filter((item) => item.name && isVideoName(item.name));
    out.push(...items.map((item) => `${prefix}/${item.name}`));
    if ((data || []).length < 1000) break;
  }
  return out;
}

async function existingGenRefs(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<{ urls: Set<string>; sourceUrls: Set<string> }> {
  const urls = new Set<string>();
  const sourceUrls = new Set<string>();
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db
      .from("content_assets")
      .select("url,analysis")
      .eq("disk", "gen")
      .range(from, from + 999);
    if (error) throw new Error(`content_assets lookup: ${error.message}`);
    for (const row of (data || []) as { url?: string | null; analysis?: Record<string, unknown> | null }[]) {
      if (row.url) urls.add(row.url);
      const sourceUrl = typeof row.analysis?.source_url === "string" ? row.analysis.source_url : "";
      if (sourceUrl) sourceUrls.add(sourceUrl);
    }
    if ((data || []).length < 1000) break;
  }
  return { urls, sourceUrls };
}

function rowForPath(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, path: string) {
  const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || "";
  const stem = path.split("/").pop()?.replace(/\.(mp4|mov|webm)$/i, "") || path;
  return {
    disk: "gen",
    path: `storage-reconcile/${path}`,
    name: `storage restore ${stem}`.slice(0, 120),
    kind: "video",
    niche: null,
    article: null,
    color: null,
    url,
    analyzed: true,
    analysis: {
      source: "storage_reconcile",
      source_url: url,
      storage_path: path,
      restored_from_prefix: path.split("/")[0] || null,
    },
  };
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return reconcile(false);
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return reconcile(body.apply === true);
}

async function reconcile(apply: boolean) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

    const paths = (await Promise.all(PREFIXES.map((prefix) => listPrefix(db, prefix)))).flat();
    const rows = paths.map((path) => rowForPath(db, path)).filter((row) => row.url);
    const existing = await existingGenRefs(db);
    const missing = rows.filter((row) => !existing.urls.has(row.url) && !existing.sourceUrls.has(row.url));

    let inserted = 0;
    let skipped_duplicate = 0;
    const errors: string[] = [];
    if (apply && missing.length) {
      for (const row of missing) {
        const { error } = await db.from("content_assets").insert(row);
        if (!error) {
          inserted += 1;
          continue;
        }
        if ((error as { code?: string }).code === "23505") {
          skipped_duplicate += 1;
          continue;
        }
        errors.push(error.message.slice(0, 180));
        if (errors.length >= 20) break;
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      apply,
      scanned_paths: paths.length,
      catalog_existing_urls: existing.urls.size,
      catalog_existing_source_urls: existing.sourceUrls.size,
      missing: missing.length,
      inserted,
      skipped_duplicate,
      errors,
      sample_missing: missing.slice(0, 20).map((row) => ({ path: row.analysis.storage_path, url: row.url })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      apply,
      scanned_paths: 0,
      catalog_existing_urls: 0,
      catalog_existing_source_urls: 0,
      missing: 0,
      inserted: 0,
      skipped_duplicate: 0,
      errors: [`reconcile crash: ${String((e as Error)?.message || e).slice(0, 180)}`],
      sample_missing: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
