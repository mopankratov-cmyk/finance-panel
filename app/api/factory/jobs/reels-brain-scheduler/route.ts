import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildReelsBrainSchedulerPlan } from "@/lib/factory/reelsBrainScheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function requestedTask(value: unknown): "bulk" | "analyze" | "daily" | "weekly" {
  const raw = String(value || "bulk").trim().toLowerCase();
  if (raw === "weekly") return "weekly";
  if (raw === "daily") return "daily";
  if (raw === "analyze") return "analyze";
  return "bulk";
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const plan = buildReelsBrainSchedulerPlan({
    niches: req.nextUrl.searchParams.get("niches"),
    platforms: req.nextUrl.searchParams.get("platforms"),
    max_lanes: req.nextUrl.searchParams.get("max_lanes"),
    limit: req.nextUrl.searchParams.get("limit"),
    max_provider_calls: req.nextUrl.searchParams.get("max_provider_calls"),
    max_cost_units: req.nextUrl.searchParams.get("max_cost_units"),
  });
  return NextResponse.json({
    ok: true,
    mode: "scheduler_plan",
    ...plan,
    next_action: "POST this endpoint with task=bulk|analyze|daily|weekly to execute one scheduled tick.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const plan = buildReelsBrainSchedulerPlan({
    niches: typeof body.niches === "string" ? body.niches : req.nextUrl.searchParams.get("niches"),
    platforms: typeof body.platforms === "string" ? body.platforms : req.nextUrl.searchParams.get("platforms"),
    max_lanes: body.max_lanes || req.nextUrl.searchParams.get("max_lanes"),
    limit: body.limit || req.nextUrl.searchParams.get("limit"),
    max_provider_calls: body.max_provider_calls || req.nextUrl.searchParams.get("max_provider_calls"),
    max_cost_units: body.max_cost_units || req.nextUrl.searchParams.get("max_cost_units"),
  });
  const task = requestedTask(body.task || req.nextUrl.searchParams.get("task"));
  const selected = plan.tasks.find((row) => row.task === task) || plan.tasks[0];
  const cookie = req.headers.get("cookie");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;

  const response = await internalFetch(`${req.nextUrl.origin}${selected.endpoint}`, {
    method: selected.method,
    headers,
    body: JSON.stringify({ ...selected.payload, ...(typeof body.payload === "object" && body.payload ? body.payload : {}) }),
    signal: AbortSignal.timeout(115000),
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json({
    ok: response.ok && (result as { ok?: boolean }).ok !== false,
    mode: "scheduler_tick",
    task,
    selected,
    result,
  }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
