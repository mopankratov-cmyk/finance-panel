import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { archiveAndReleaseStorageOnlyOrphans } from "@/lib/factory/storageCleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function intParam(req: NextRequest, name: string, fallback: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  return Number.isFinite(value) ? value : fallback;
}

async function runOrphanArchiveRelease(req: NextRequest, limit: number) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabaseAdmin();
    const snapshot = await archiveAndReleaseStorageOnlyOrphans(db, {
      limit,
      storageLimit: intParam(req, "storage_limit", 5000),
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      destructive: true,
      apply: true,
      archived: 0,
      deleted: 0,
      failed: 0,
      error: `storage orphan archive-release crash: ${String((error as Error)?.message || error).slice(0, 220)}`,
      items: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const apply = sp.get("apply") === "1" && sp.get("confirm") === "archive-release-storage-orphans";
  if (!apply) {
    return NextResponse.json({
      ok: false,
      destructive: true,
      apply: false,
      error: "confirmation required: apply=1&confirm=archive-release-storage-orphans",
      items: [],
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return runOrphanArchiveRelease(req, intParam(req, "limit", 5));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.apply !== true || body.confirm !== "archive-release-storage-orphans") {
    return NextResponse.json({
      ok: false,
      destructive: true,
      apply: false,
      error: "confirmation required",
      items: [],
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return runOrphanArchiveRelease(req, Number(body.limit || 5));
}
