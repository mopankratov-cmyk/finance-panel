import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelsBrainDecisionSnapshot } from "@/lib/factory/reelsBrainDecisionSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type JsonRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(req: NextRequest) {
  try {
    const lane = text(req.nextUrl.searchParams.get("lane"));
    const niche = text(req.nextUrl.searchParams.get("niche"));
    const platform = text(req.nextUrl.searchParams.get("platform"));
    const niches = req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics";
    const limit = req.nextUrl.searchParams.get("limit") || "80";

    const exportsUrl = new URL("/api/factory/reels-brain/creative-exports", req.nextUrl.origin);
    exportsUrl.searchParams.set("niches", niches);
    exportsUrl.searchParams.set("limit", limit);
    if (lane) exportsUrl.searchParams.set("lane", lane);
    if (niche) exportsUrl.searchParams.set("niche", niche);
    if (platform) exportsUrl.searchParams.set("platform", platform);

    const auditUrl = new URL("/api/factory/reels-brain/readiness-audit", req.nextUrl.origin);
    auditUrl.searchParams.set("niches", niches);
    auditUrl.searchParams.set("limit", limit);
    if (lane) {
      const verdict = lane === "ship" ? "ship" : lane === "validate" ? "validate" : "research";
      auditUrl.searchParams.set("verdict", verdict);
    }
    if (niche) auditUrl.searchParams.set("niche", niche);
    if (platform) auditUrl.searchParams.set("platform", platform);

    const [exportsRes, auditRes] = await Promise.all([
      internalFetch(exportsUrl),
      internalFetch(auditUrl),
    ]);
    const exportsBody = await exportsRes.json().catch(() => ({}));
    const auditBody = await auditRes.json().catch(() => ({}));
    if (!exportsRes.ok) return NextResponse.json(exportsBody, { status: exportsRes.status });
    if (!auditRes.ok) return NextResponse.json(auditBody, { status: auditRes.status });

    const snapshot = buildReelsBrainDecisionSnapshot({
      creativeExports: exportsBody as {
        summary?: Record<string, unknown> | null;
        ship_now?: JsonRecord[];
        validate_next?: JsonRecord[];
        research_queue?: JsonRecord[];
        items?: JsonRecord[];
      },
      readinessAudit: auditBody as {
        summary?: Record<string, unknown> | null;
        items?: JsonRecord[];
      },
      lane,
      niche,
      platform,
    });

    return NextResponse.json({
      ok: true,
      ...snapshot,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "decision-snapshot reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
