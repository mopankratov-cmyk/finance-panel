import { NextRequest, NextResponse } from "next/server";
import { buildDetachedUgcStoryboard, RUSSIAN_HEYGEN_BLOGGERS } from "@/lib/factory/ugcStoryboard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bloggerKey = typeof body.blogger_key === "string" ? body.blogger_key : "";
    const blogger = body.blogger || RUSSIAN_HEYGEN_BLOGGERS[bloggerKey as keyof typeof RUSSIAN_HEYGEN_BLOGGERS] || RUSSIAN_HEYGEN_BLOGGERS.katya;
    const storyboard = buildDetachedUgcStoryboard({ ...body, blogger });

    return NextResponse.json({
      ok: storyboard.ok,
      mode: storyboard.mode,
      storyboard,
      note: "Dry-run only. Render HeyGen face and product B-roll through separate budget-guarded actions.",
    }, { status: storyboard.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "ugc-storyboard crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
