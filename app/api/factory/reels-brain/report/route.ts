import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  try {
    const url = new URL("/api/factory/reels-brain/learning-economics", req.nextUrl.origin);
    url.searchParams.set("niches", req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    url.searchParams.set("limit", req.nextUrl.searchParams.get("limit") || "80");
    const response = await internalFetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    return NextResponse.json({
      ok: true,
      report_type: req.nextUrl.searchParams.get("type") || "daily",
      daily_report: body.daily_report || null,
      totals: body.totals || null,
      quality_gate: body.quality_gate || null,
      niche_comparison: body.niche_comparison || [],
      anti_pattern_brain: body.anti_pattern_brain || null,
      discovery_brain: body.discovery_brain || null,
      feedback_loop: body.feedback_loop || body.next_intelligence_layers?.feedback_loop || null,
      audio_visual_intelligence: body.audio_visual_intelligence || body.next_intelligence_layers?.audio_visual_intelligence || null,
      product_brain: body.product_brain || body.next_intelligence_layers?.product_brain || null,
      audience_brain: body.audience_brain || body.next_intelligence_layers?.audience_brain || null,
      experiment_brain: body.experiment_brain || body.next_intelligence_layers?.experiment_brain || null,
      portfolio_manager: body.portfolio_manager || body.next_intelligence_layers?.portfolio_manager || null,
      cost_governor: body.cost_governor || null,
      autopilot_actions: body.autopilot_actions || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "report reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
