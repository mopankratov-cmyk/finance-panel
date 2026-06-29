import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildFactoryStorageCleanupDryRun } from "@/lib/factory/storageCleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function intParam(req: NextRequest, name: string, fallback: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabaseAdmin();
    const snapshot = await buildFactoryStorageCleanupDryRun(db, {
      limit: intParam(req, "limit", 500),
      storageLimit: intParam(req, "storage_limit", 1000),
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      destructive: false,
      apply: false,
      error: `storage-cleanup dry-run crash: ${String((error as Error)?.message || error).slice(0, 220)}`,
      candidates: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
