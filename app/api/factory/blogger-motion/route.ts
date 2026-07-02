import { NextRequest, NextResponse } from "next/server";
import {
  BLOGGER_MOTION_PRESETS,
  buildControlledBloggerBatch,
  detectBloggerRepeatability,
  scoreRepeatabilityAsEvaluation,
} from "@/lib/factory/bloggerMotion";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "detached-blogger-motion-dry-run",
    presets: BLOGGER_MOTION_PRESETS,
    note: "Dry-run only. This endpoint creates motion test plans and repeatability reports without rendering video.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode = typeof body.mode === "string" ? body.mode : "batch";
    if (mode === "repeatability") {
      const repeatability = detectBloggerRepeatability(Array.isArray(body.samples) ? body.samples : []);
      const evaluation = body.blogger_id
        ? scoreRepeatabilityAsEvaluation({
            blogger_id: body.blogger_id,
            variant_id: body.variant_id,
            run_id: body.run_id,
            samples: Array.isArray(body.samples) ? body.samples : [],
          })
        : null;
      return NextResponse.json({
        ok: true,
        mode: "detached-blogger-repeatability-dry-run",
        repeatability,
        evaluation,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const batch = buildControlledBloggerBatch(body);
    return NextResponse.json({
      ok: batch.ok,
      mode: batch.mode,
      batch,
    }, { status: batch.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "blogger-motion crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
