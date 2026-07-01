import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type JsonRecord = Record<string, any>;

function readString(req: NextRequest, key: string, fallback: string) {
  return String(req.nextUrl.searchParams.get(key) || fallback).trim();
}

function readNumber(req: NextRequest, key: string, fallback: number, min: number, max: number) {
  const parsed = Number(req.nextUrl.searchParams.get(key) || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function fetchLearningPlan(req: NextRequest) {
  const url = new URL("/api/factory/reels-brain/learning-plan", req.nextUrl.origin);
  url.searchParams.set("niches", readString(req, "niches", "ru_toys,ru_clothing,ru_cosmetics"));
  url.searchParams.set("platforms", readString(req, "platforms", "tiktok,instagram,youtube"));
  url.searchParams.set("target", String(readNumber(req, "target", 10000, 300, 250000)));
  url.searchParams.set("max_backlog_before_analyze", String(readNumber(req, "max_backlog_before_analyze", 180, 20, 2000)));
  url.searchParams.set("limit", String(readNumber(req, "limit", 80, 10, 500)));
  const response = await internalFetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || response.statusText);
  return body as JsonRecord;
}

async function executeNextTick(req: NextRequest, plan: JsonRecord, execute: boolean) {
  const nextTick = (plan.learning_plan?.next_tick || {}) as JsonRecord;
  const task = String(nextTick.task || "").trim();
  const params = (nextTick.params || {}) as Record<string, string>;
  const endpoint = String(nextTick.endpoint || "").trim();

  if (!execute || !endpoint || task === "wait_or_repair_sources") {
    return {
      executed: false,
      task,
      endpoint,
      params,
      result: null,
      reason: task === "wait_or_repair_sources"
        ? "guard paused paid collection; operator should inspect providers or costs"
        : "dry-run only",
    };
  }

  if (endpoint === "/api/factory/jobs/reels-brain-cron") {
    const url = new URL(endpoint, req.nextUrl.origin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("niches", readString(req, "niches", "ru_toys,ru_clothing,ru_cosmetics"));
    url.searchParams.set("platforms", readString(req, "platforms", "tiktok,instagram,youtube"));
    const response = await internalFetch(url);
    const result = await response.json().catch(() => ({}));
    return { executed: true, task, endpoint, params, result, ok: response.ok };
  }

  if (endpoint === "/api/factory/jobs/reels-brain-learning") {
    const body: Record<string, unknown> = {
      ...params,
      niches: readString(req, "niches", "ru_toys,ru_clothing,ru_cosmetics"),
      platforms: readString(req, "platforms", "tiktok,instagram,youtube"),
      hours: readNumber(req, "hours", 72, 1, 168),
    };
    const response = await internalFetch(`${req.nextUrl.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115000),
    });
    const result = await response.json().catch(() => ({}));
    return { executed: true, task, endpoint, params: body, result, ok: response.ok };
  }

  return {
    executed: false,
    task,
    endpoint,
    params,
    result: null,
    reason: `unsupported endpoint ${endpoint}`,
  };
}

async function runAutopilot(req: NextRequest, execute: boolean) {
  const plan = await fetchLearningPlan(req);
  const execution = await executeNextTick(req, plan, execute);
  return NextResponse.json({
    ok: execution.ok !== false,
    mode: "reels_brain_autopilot",
    execute,
    learning_plan: plan.learning_plan || null,
    execution,
    next_action: execute
      ? `Call again in ${(plan.learning_plan?.worker_loop?.next_run_after_minutes || 15)} minutes while unattended_ready=true.`
      : "POST this endpoint to execute the recommended next tick.",
  }, { status: execution.ok === false ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await runAutopilot(req, false);
  } catch (e) {
    return NextResponse.json({ error: "reels-brain-autopilot crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await runAutopilot(req, true);
  } catch (e) {
    return NextResponse.json({ error: "reels-brain-autopilot crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
