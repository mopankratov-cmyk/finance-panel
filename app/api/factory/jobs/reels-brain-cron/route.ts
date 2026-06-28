import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";

function requestedTask(req: NextRequest): "bulk" | "analyze" {
  const raw = String(req.nextUrl.searchParams.get("task") || req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
  if (raw === "bulk" || raw === "ingest") return "bulk";
  if (raw === "analyze" || raw === "analysis") return "analyze";

  // Vercel cron runs every 5 minutes: one corpus-fill tick per hour, eleven analyze ticks per hour.
  return new Date().getUTCMinutes() === 0 ? "bulk" : "analyze";
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const task = requestedTask(req);
    const niches = req.nextUrl.searchParams.get("niches") || DEFAULT_NICHES;
    const platforms = req.nextUrl.searchParams.get("platforms") || DEFAULT_PLATFORMS;
    const endpoint = task === "bulk"
      ? "/api/factory/jobs/reels-brain-learning"
      : "/api/factory/jobs/reels-brain-analyze-backlog";
    const body = task === "bulk"
      ? {
        niches,
        platforms,
        strategy: "bulk",
        max_lanes: 2,
        limit: 25,
        providers_per_lane: 1,
        provider_timeout_ms: 30000,
        max_provider_calls: 4,
        max_cost_units: 10,
        hours: 72,
      }
      : {
        niches,
        platforms,
        max_lanes: 6,
        limit: 18,
        build_patterns: false,
      };

    const response = await internalFetch(`${req.nextUrl.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115000),
    });
    const result = await response.json().catch(() => ({}));

    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      mode: "reels_brain_cron",
      task,
      cadence: "*/5 * * * *",
      policy: "bulk at minute 00 UTC, analyze on the other 5-minute ticks",
      endpoint,
      result,
    }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "reels-brain-cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
