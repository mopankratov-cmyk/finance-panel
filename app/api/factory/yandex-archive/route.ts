import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { archiveFactoryVideosToYandex } from "@/lib/factory/yandexArchive";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function intParam(req: NextRequest, name: string, fallback: number): number {
  const value = Number(new URL(req.url).searchParams.get(name) || fallback);
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const sp = new URL(req.url).searchParams;
    const apply = sp.get("apply") === "1" && sp.get("confirm") === "copy-to-yandex";
    const db = getSupabaseAdmin();
    const snapshot = await archiveFactoryVideosToYandex(db, {
      apply,
      limit: intParam(req, "limit", 10),
      includeArchived: sp.get("include_archived") === "1",
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      apply: false,
      error: `yandex-archive GET crash: ${String((error as Error)?.message || error).slice(0, 220)}`,
      items: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const db = getSupabaseAdmin();
    const snapshot = await archiveFactoryVideosToYandex(db, {
      apply: body.apply === true,
      limit: Number(body.limit || 10),
      includeArchived: body.include_archived === true,
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      apply: false,
      error: `yandex-archive POST crash: ${String((error as Error)?.message || error).slice(0, 220)}`,
      items: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
