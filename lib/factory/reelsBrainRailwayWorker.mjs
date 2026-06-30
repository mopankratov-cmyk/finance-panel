#!/usr/bin/env node

import { summarizeReelsMediaAssets } from "./reelsBrainMediaAssetResolver.mjs";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(text);
}

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value, max = 900) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const opts = parseArgs(process.argv);
const baseUrl = String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const secret = String(opts.secret || process.env.CRON_SECRET || "");
const workerId = String(process.env.WORKER_ID || "railway-reels-brain-offline");
const label = String(process.env.WORKER_LABEL || "Reels Brain Offline Workers");
const niches = String(opts.niches || process.env.REELS_BRAIN_NICHES || DEFAULT_NICHES);
const platforms = String(opts.platforms || process.env.REELS_BRAIN_PLATFORMS || DEFAULT_PLATFORMS);
const loopEverySec = numberEnv("REELS_BRAIN_LOOP_EVERY_SEC", 600, 60, 86_400);
const analyzeLimit = numberEnv("REELS_BRAIN_ANALYZE_LIMIT", 25, 1, 25);
const maxLanes = numberEnv("REELS_BRAIN_MAX_LANES", 9, 1, 9);
const patternLimit = numberEnv("REELS_BRAIN_PATTERN_LIMIT", 3000, 10, 3000);
const mediaResolveLimit = numberEnv("REELS_BRAIN_MEDIA_RESOLVE_LIMIT", 60, 1, 200);
const mediaResolverLimit = numberEnv("REELS_BRAIN_APIFY_MEDIA_RESOLVER_LIMIT", 1, 1, 20);
const mediaResolverPollSec = numberEnv("REELS_BRAIN_APIFY_MEDIA_RESOLVER_POLL_SEC", 240, 30, 1200);
const enableBulk = bool(opts.bulk ?? process.env.REELS_BRAIN_ENABLE_BULK, false);
const enableMediaResolver = bool(opts.mediaResolver ?? process.env.REELS_BRAIN_ENABLE_MEDIA_RESOLVER, false);
const buildPatterns = bool(process.env.REELS_BRAIN_BUILD_PATTERNS, true);
const once = bool(opts.once, false);

if (opts.help) {
  console.log(`Usage:
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainRailwayWorker.mjs --once
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainRailwayWorker.mjs

Env:
  BASE_URL                         Product URL, defaults to ${DEFAULT_BASE_URL}
  CRON_SECRET                      Required bearer token for protected factory jobs
  REELS_BRAIN_NICHES               Default: ${DEFAULT_NICHES}
  REELS_BRAIN_PLATFORMS            Default: ${DEFAULT_PLATFORMS}
  REELS_BRAIN_LOOP_EVERY_SEC       Default: 600
  REELS_BRAIN_ANALYZE_LIMIT        Default/max: 25 per lane
  REELS_BRAIN_MAX_LANES            Default/max: 9
  REELS_BRAIN_PATTERN_LIMIT        Default/max: 3000 per niche
  REELS_BRAIN_MEDIA_RESOLVE_LIMIT  Default/max: 60 corpus rows per cycle
  REELS_BRAIN_ENABLE_MEDIA_RESOLVER Default false, true starts async Apify video resolver
  REELS_BRAIN_APIFY_MEDIA_RESOLVER_LIMIT Default/max: 1/20 videos per resolver run
  REELS_BRAIN_APIFY_MEDIA_RESOLVER_POLL_SEC Default/max: 240/1200
  REELS_BRAIN_ENABLE_BULK          Default false, true allows paid corpus growth provider calls
  REELS_BRAIN_BUILD_PATTERNS       Default true
`);
  process.exit(0);
}

if (!secret) {
  console.error("CRON_SECRET is required for Railway Reels Brain worker");
  process.exit(1);
}

async function request(path, init = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(Number(init.timeoutMs || 120_000)),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText}: ${compact(body, 500)}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function heartbeat(status, progress, extra = {}) {
  const payload = {
    worker_id: workerId,
    label,
    status,
    branch: process.env.WORKER_BRANCH || "feat/reels-brain-railway-offline-workers",
    current_task_id: extra.task_id || "RB-OFFLINE",
    current_task_title: extra.task_title || "Reels Brain offline intelligence workers",
    progress,
    blocker: extra.blocker || "",
    note: extra.note || `niches=${niches}; platforms=${platforms}; bulk=${enableBulk ? "enabled" : "disabled"}`,
    queue: [
      { id: "RB-1", title: "Analyze stored backlog", status: status === "working" ? "doing" : status, priority: "P0" },
      { id: "RB-2", title: "Rebuild pattern memory", status: "todo", priority: "P0" },
      { id: "RB-3", title: "Refresh digest/readiness surfaces", status: "todo", priority: "P1" },
      { id: "RB-4", title: "Optional paid corpus growth", status: enableBulk ? "todo" : "blocked", priority: "P2", blockers: enableBulk ? [] : ["disabled by REELS_BRAIN_ENABLE_BULK=false"] },
      { id: "RB-5", title: "Optional Apify async media resolver", status: enableMediaResolver ? "todo" : "blocked", priority: "P2", blockers: enableMediaResolver ? [] : ["disabled by REELS_BRAIN_ENABLE_MEDIA_RESOLVER=false"] },
    ],
  };
  return request("/api/factory/worker-state", { method: "POST", body: JSON.stringify(payload), timeoutMs: 20_000 });
}

async function safeHeartbeat(status, progress, extra = {}) {
  try {
    return await heartbeat(status, progress, extra);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      at: new Date().toISOString(),
      kind: "heartbeat_failed_non_blocking",
      status,
      progress,
      error: String(error?.message || error).slice(0, 700),
    }));
    return null;
  }
}

async function runStep(name, fn) {
  const started = Date.now();
  await safeHeartbeat("working", `running ${name}`);
  try {
    const result = await fn();
    const durationSec = Math.round((Date.now() - started) / 1000);
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: name, duration_sec: durationSec, result }, null, 2));
    await safeHeartbeat("working", `finished ${name} in ${durationSec}s`, { note: compact(result, 700) });
    return { ok: true, name, duration_sec: durationSec, result };
  } catch (error) {
    const durationSec = Math.round((Date.now() - started) / 1000);
    const message = String(error?.message || error).slice(0, 800);
    console.error(JSON.stringify({ ok: false, at: new Date().toISOString(), step: name, duration_sec: durationSec, error: message, body: error?.body || null }, null, 2));
    await safeHeartbeat("working", `step ${name} failed; continuing`, { blocker: message });
    return { ok: false, name, duration_sec: durationSec, error: message };
  }
}

async function runCycle() {
  const cycleStarted = new Date().toISOString();
  await safeHeartbeat("working", `cycle started ${cycleStarted}`);

  const results = [];
  if (enableBulk) {
    results.push(await runStep("paid corpus growth cron", () => request(
      `/api/factory/jobs/reels-brain-cron?task=bulk&target=10000&niches=${encodeURIComponent(niches)}&platforms=${encodeURIComponent(platforms)}`,
      { method: "GET", timeoutMs: 125_000 },
    )));
  } else {
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "paid corpus growth cron", skipped: true, reason: "REELS_BRAIN_ENABLE_BULK=false" }));
  }

  if (enableMediaResolver) {
    results.push(await runStep("apify async media resolver", async () => {
      const firstNiche = niches.split(",").map((row) => row.trim()).filter(Boolean)[0] || "ru_toys";
      const query = String(process.env.REELS_BRAIN_APIFY_MEDIA_RESOLVER_QUERY || `${firstNiche} reels`).trim();
      const start = await request("/api/factory/reels-brain/media-resolver/apify", {
        method: "POST",
        timeoutMs: 45_000,
        body: JSON.stringify({
          action: "start",
          niche: firstNiche,
          query,
          limit: mediaResolverLimit,
          download_videos: true,
        }),
      });
      const runId = start.run_id;
      if (!runId) return { ...start, warning: "run_id missing" };
      const deadline = Date.now() + mediaResolverPollSec * 1000;
      let latest = start;
      while (Date.now() < deadline) {
        await sleep(20_000);
        latest = await request("/api/factory/reels-brain/media-resolver/apify", {
          method: "POST",
          timeoutMs: 60_000,
          body: JSON.stringify({
            action: "poll",
            run_id: runId,
            dataset_id: latest.dataset_id || start.dataset_id || null,
            niche: firstNiche,
            query,
            limit: mediaResolverLimit,
          }),
        });
        if (latest.done || ["FAILED", "ABORTED", "TIMED-OUT"].includes(String(latest.status || ""))) break;
      }
      return latest;
    }));
  } else {
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "apify async media resolver", skipped: true, reason: "REELS_BRAIN_ENABLE_MEDIA_RESOLVER=false" }));
  }

  results.push(await runStep("resolve media assets", async () => {
    const allVideos = [];
    for (const niche of niches.split(",").map((row) => row.trim()).filter(Boolean)) {
      const corpus = await request(`/api/factory/reels-brain/corpus?niche=${encodeURIComponent(niche)}&limit=${mediaResolveLimit}`, {
        method: "GET",
        timeoutMs: 45_000,
      });
      if (Array.isArray(corpus?.videos)) allVideos.push(...corpus.videos);
    }
    return summarizeReelsMediaAssets(allVideos);
  }));

  results.push(await runStep("media intelligence report", () => request(
    `/api/factory/reels-brain/media-intelligence?niches=${encodeURIComponent(niches)}&limit_per_niche=${mediaResolveLimit}`,
    { method: "GET", timeoutMs: 60_000 },
  )));

  results.push(await runStep("analyze stored backlog", () => request("/api/factory/jobs/reels-brain-analyze-backlog", {
    method: "POST",
    timeoutMs: 125_000,
    body: JSON.stringify({
      niches,
      platforms,
      max_lanes: maxLanes,
      limit: analyzeLimit,
      build_patterns: buildPatterns,
    }),
  })));

  results.push(await runStep("rebuild pattern memory", () => request("/api/factory/reels-brain/patterns/build-all", {
    method: "POST",
    timeoutMs: 125_000,
    body: JSON.stringify({
      niches,
      limit: patternLimit,
      max_corpus_rows: 20000,
    }),
  })));

  results.push(await runStep("refresh portfolio digest", () => request(
    `/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(niches)}`,
    { method: "GET", timeoutMs: 45_000 },
  )));

  const ok = results.every((row) => row.ok);
  await safeHeartbeat(ok ? "working" : "blocked", ok ? "cycle finished; waiting next tick" : "cycle finished with recoverable errors", {
    note: compact({ cycle_started: cycleStarted, results: results.map((r) => ({ name: r.name, ok: r.ok, duration_sec: r.duration_sec, error: r.error || null })) }, 900),
  });
  return { ok, cycle_started: cycleStarted, results };
}

console.log(JSON.stringify({
  ok: true,
  at: new Date().toISOString(),
  worker: workerId,
  base_url: baseUrl,
  niches,
  platforms,
  loop_every_sec: loopEverySec,
  analyze_limit: analyzeLimit,
  max_lanes: maxLanes,
  pattern_limit: patternLimit,
  media_resolve_limit: mediaResolveLimit,
  enable_media_resolver: enableMediaResolver,
  media_resolver_limit: mediaResolverLimit,
  media_resolver_poll_sec: mediaResolverPollSec,
  enable_bulk: enableBulk,
  build_patterns: buildPatterns,
}, null, 2));

if (once) {
  const result = await runCycle();
  process.exit(result.ok ? 0 : 1);
}

while (true) {
  await runCycle().catch(async (error) => {
    const message = String(error?.message || error).slice(0, 800);
    console.error(JSON.stringify({ ok: false, at: new Date().toISOString(), error: message }, null, 2));
    await safeHeartbeat("blocked", "cycle crashed; worker will retry", { blocker: message });
  });
  await sleep(loopEverySec * 1000);
}
