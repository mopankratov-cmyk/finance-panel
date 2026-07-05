import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function safeJson(url: URL) {
  try {
    const res = await internalFetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    return {
      ok: res.ok,
      status: res.status,
      body: await res.json().catch(() => ({})),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { error: String((error as Error)?.message || error).slice(0, 180) },
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const niches = req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics";
    const progressUrl = new URL("/api/factory/reels-brain/progress", req.nextUrl.origin);
    progressUrl.searchParams.set("niches", niches);
    const providersUrl = new URL("/api/factory/reels-brain/providers", req.nextUrl.origin);
    const workerUrl = new URL("/api/factory/worker-state", req.nextUrl.origin);
    const reportUrl = new URL("/api/factory/reels-brain/report", req.nextUrl.origin);
    reportUrl.searchParams.set("niches", niches);

    const [progressRes, providersRes, workerRes, reportRes] = await Promise.all([
      safeJson(progressUrl),
      safeJson(providersUrl),
      safeJson(workerUrl),
      safeJson(reportUrl),
    ]);

    const progress = rec(progressRes.body);
    const providers = rec(providersRes.body);
    const worker = rec(workerRes.body);
    const report = rec(reportRes.body);
    const pipeline = rec(report.pipeline_progress || progress);
    const totals = rec(pipeline.totals);
    const primaryBottleneck = rec(pipeline.primary_bottleneck);
    const availableProviders = Array.isArray(providers.available) ? providers.available : [];

    return NextResponse.json({
      ok: true,
      niches: niches.split(",").map((row) => row.trim()).filter(Boolean),
      health: {
        status: workerRes.ok && providersRes.ok && progressRes.ok ? "healthy" : "degraded",
        primary_bottleneck: primaryBottleneck,
        pipeline: {
          throughput_24h: pipeline.throughput_24h || null,
          totals,
          platforms: Array.isArray(pipeline.platforms) ? pipeline.platforms : [],
        },
        providers: {
          available: availableProviders,
          count: availableProviders.length,
          trend_source: providers.trend_source || null,
          scheduler: providers.scheduler || null,
        },
        worker: {
          issue: worker.worker_issue || null,
          heartbeat_diagnostics: worker.heartbeat_diagnostics || null,
          current: worker.worker || null,
          warnings: worker.warnings || [],
        },
        source_mix_audit: report.source_mix_audit || null,
      },
      sources: {
        providers: availableProviders,
        source_intelligence: report.discovery_brain || null,
        source_mix_audit: report.source_mix_audit || null,
        autopilot_actions: report.autopilot_actions || null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "health reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
