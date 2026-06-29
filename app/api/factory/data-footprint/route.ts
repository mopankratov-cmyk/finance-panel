import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadFactoryDataFootprint } from "@/lib/factory/dataFootprint";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const db = getSupabaseAdmin();
    const snapshot = await loadFactoryDataFootprint(db);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      destructive: false,
      error: `data-footprint crash: ${String((error as Error)?.message || error).slice(0, 220)}`,
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
