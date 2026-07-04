import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type JsonRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown) {
  return Array.isArray(value) ? value as JsonRecord[] : [];
}

function keyOf(niche: unknown, platform: unknown) {
  return `${text(niche)}__${text(platform)}`;
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

    const exportItems = list((exportsBody as JsonRecord).items);
    const auditItems = list((auditBody as JsonRecord).items);
    const auditMap = new Map(auditItems.map((row) => [keyOf(row.niche, row.platform), row] as const));
    const items = exportItems.map((row) => {
      const audit = auditMap.get(keyOf(row.niche, row.platform)) || {};
      return {
        ...row,
        audit,
      };
    });

    return NextResponse.json({
      ok: true,
      lane: lane || null,
      niche: niche || null,
      platform: platform || null,
      summary: {
        exports: (exportsBody as JsonRecord).summary || null,
        audit: (auditBody as JsonRecord).summary || null,
        filtered_total: items.length,
      },
      ship_now: list((exportsBody as JsonRecord).ship_now).map((row) => ({
        ...row,
        audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
      })),
      validate_next: list((exportsBody as JsonRecord).validate_next).map((row) => ({
        ...row,
        audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
      })),
      research_queue: list((exportsBody as JsonRecord).research_queue).map((row) => ({
        ...row,
        audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
      })),
      items,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "decision-snapshot reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
