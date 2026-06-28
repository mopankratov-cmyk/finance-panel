#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_QUERIES = ["water gun review"];
const DEFAULT_LIMIT = 5;
const DEFAULT_NICHE = "smoke";
const DEFAULT_PLATFORM = "tiktok";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PORTFOLIO_NICHES = ["toys", "clothing", "cosmetics", "default"];

const PROVIDER_PREFERENCE = [
  "apify_tiktok",
  "virlo",
  "apify_instagram",
  "apify_youtube",
  "youtube",
  "bright_tiktok",
  "bright_instagram",
  "bright_youtube",
  "ensemble_tiktok",
  "ensemble_instagram",
  "ensemble_youtube",
  "apify",
];

function usage() {
  return `
Reels Brain production smoke.

Required:
  CRON_SECRET=... node lib/factory/reelsBrainSmoke.mjs

Options:
  --base-url <url>         Default: ${DEFAULT_BASE_URL}
  --secret <token>         Override CRON_SECRET without printing it
  --niche <name>           Default: ${DEFAULT_NICHE}
  --platform <name>        Default: ${DEFAULT_PLATFORM}
  --query <text>           Can be repeated. Default: ${DEFAULT_QUERIES[0]}
  --providers <a,b,c>      Default: auto-select configured providers
  --limit <n>              Per-provider limit. Default: ${DEFAULT_LIMIT}
  --persist                Write rows to viral_videos. Default: report-only
  --allow-empty            Exit 0 even if providers return no valid videos
  --check-ops              Also verify summary, digest-all, and ops snapshots
  --check-growth           Also verify the 10k corpus growth planning endpoint
  --check-bulk             Also verify the raw bulk ingest planning endpoint
  --portfolio-niches <a,b> Default: ${DEFAULT_PORTFOLIO_NICHES.join(",")}
  --json                   Print full JSON responses after the compact summary
  --timeout-ms <n>         Default: ${DEFAULT_TIMEOUT_MS}
`.trim();
}

function readFlag(args, index) {
  const arg = args[index];
  const eq = arg.indexOf("=");
  if (eq !== -1) return { value: arg.slice(eq + 1), next: index + 1 };
  return { value: args[index + 1], next: index + 2 };
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BASE_URL || DEFAULT_BASE_URL,
    secret: process.env.CRON_SECRET || "",
    niche: DEFAULT_NICHE,
    platform: DEFAULT_PLATFORM,
    queries: [],
    providers: [],
    limit: DEFAULT_LIMIT,
    persist: false,
    allowEmpty: false,
    checkOps: false,
    checkGrowth: false,
    checkBulk: false,
    portfolioNiches: [...DEFAULT_PORTFOLIO_NICHES],
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      i += 1;
      continue;
    }
    if (arg === "--persist") {
      opts.persist = true;
      i += 1;
      continue;
    }
    if (arg === "--allow-empty") {
      opts.allowEmpty = true;
      i += 1;
      continue;
    }
    if (arg === "--check-ops") {
      opts.checkOps = true;
      i += 1;
      continue;
    }
    if (arg === "--check-growth") {
      opts.checkGrowth = true;
      i += 1;
      continue;
    }
    if (arg === "--check-bulk") {
      opts.checkBulk = true;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      opts.json = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--base-url")) {
      const read = readFlag(argv, i);
      opts.baseUrl = String(read.value || "").trim() || opts.baseUrl;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--secret")) {
      const read = readFlag(argv, i);
      opts.secret = String(read.value || "").trim();
      i = read.next;
      continue;
    }
    if (arg.startsWith("--niche")) {
      const read = readFlag(argv, i);
      opts.niche = String(read.value || "").trim() || opts.niche;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--query")) {
      const read = readFlag(argv, i);
      const value = String(read.value || "").trim();
      if (value) opts.queries.push(value);
      i = read.next;
      continue;
    }
    if (arg.startsWith("--platform")) {
      const read = readFlag(argv, i);
      const value = String(read.value || "").trim().toLowerCase();
      opts.platform = value || opts.platform;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--providers")) {
      const read = readFlag(argv, i);
      opts.providers = String(read.value || "")
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      i = read.next;
      continue;
    }
    if (arg.startsWith("--portfolio-niches")) {
      const read = readFlag(argv, i);
      const value = String(read.value || "").trim();
      opts.portfolioNiches = value
        ? value.split(",").map((x) => x.trim()).filter(Boolean)
        : [...DEFAULT_PORTFOLIO_NICHES];
      i = read.next;
      continue;
    }
    if (arg.startsWith("--limit")) {
      const read = readFlag(argv, i);
      const limit = Number(read.value);
      opts.limit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.round(limit))) : opts.limit;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--timeout-ms")) {
      const read = readFlag(argv, i);
      const timeoutMs = Number(read.value);
      opts.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(5_000, Math.round(timeoutMs)) : opts.timeoutMs;
      i = read.next;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!opts.queries.length) opts.queries = DEFAULT_QUERIES;
  opts.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return opts;
}

function previewText(value, max = 900) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function requestJson(opts, path, init = {}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${opts.secret}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  const res = await fetch(`${opts.baseUrl}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${previewText(json)}`);
  }
  return json;
}

function selectProviders(configured, requested) {
  if (requested.length) return requested.filter((provider) => configured.includes(provider));
  const preferred = PROVIDER_PREFERENCE.filter((provider) => configured.includes(provider));
  return preferred.length ? preferred : configured.filter((provider) => provider !== "bright_instagram");
}

function compactSummary(summary) {
  return summary.map((row) => ({
    provider: row.provider,
    configured: row.configured,
    found: row.found,
    valid: row.valid,
    relevant: row.relevant,
    valid_rate: row.valid_rate,
    relevance_rate: row.relevance_rate,
    avg_score: row.avg_score,
    with_followers: row.with_followers,
    with_sound: row.with_sound,
  }));
}

function compactPortfolio(rows) {
  return rows.map((row) => ({
    niche: row.niche,
    status: row.status,
    readiness_avg: row.readiness_avg,
    total_incidents: row.total_incidents,
    critical_incidents: row.critical_incidents,
    total_videos: row.total_videos,
  }));
}

function compactGrowthQueue(rows) {
  return rows.map((row) => ({
    niche: row.niche,
    platform: row.platform,
    current: row.current_videos,
    target: row.corpus_target,
    gap: row.gap,
    progress_pct: row.progress_pct,
    queries: Array.isArray(row.plan?.queries) ? row.plan.queries.length : 0,
    source_limit: row.plan?.source_limit || 0,
  }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  if (!opts.secret) {
    console.error("CRON_SECRET is required. Pass it via env or --secret; the script never prints it.");
    process.exit(2);
  }

  console.log(`Reels Brain smoke: ${opts.baseUrl}`);
  console.log(`mode: ${opts.persist ? "persist=true" : "report-only"}`);
  console.log(`platform: ${opts.platform}`);
  console.log(`queries: ${opts.queries.join(" | ")}`);

  const providersHealth = await requestJson(opts, "/api/factory/reels-brain/providers");
  const configured = Array.isArray(providersHealth.available) ? providersHealth.available : [];
  const providers = selectProviders(configured, opts.providers);

  console.log(`configured providers: ${configured.length ? configured.join(", ") : "none"}`);
  console.log(`selected providers: ${providers.length ? providers.join(", ") : "none"}`);

  if (!providers.length) {
    console.error("No configured providers were selected. Check provider env vars in Vercel.");
    if (opts.json) console.log(JSON.stringify({ providersHealth }, null, 2));
    process.exit(3);
  }

  const bakeOff = await requestJson(opts, "/api/factory/reels-brain/bake-off", {
    method: "POST",
    body: {
      niche: opts.niche,
      queries: opts.queries,
      target_platform: opts.platform,
      providers,
      limit: opts.limit,
      persist: opts.persist,
    },
  });

  const summary = Array.isArray(bakeOff.summary_by_provider) ? bakeOff.summary_by_provider : [];
  console.table(compactSummary(summary));

  const errors = (Array.isArray(bakeOff.runs) ? bakeOff.runs : [])
    .filter((run) => run.error)
    .slice(0, 8)
    .map((run) => `${run.provider}/${run.query}: ${run.error}`);
  if (errors.length) {
    console.log("provider errors:");
    for (const error of errors) console.log(`- ${error}`);
  }

  const valid = summary.reduce((total, row) => total + Number(row.valid || 0), 0);
  console.log(`valid videos: ${valid}`);
  const bestByPlatform = bakeOff.best_provider_by_platform?.[opts.platform]?.provider || "none";
  console.log(`best provider (${opts.platform}): ${bestByPlatform}`);
  if (opts.persist) console.log(`persisted rows: ${bakeOff.persisted || 0}`);

  let summaryJson = null;
  let digestAll = null;
  let ops = null;
  let growth = null;
  let bulk = null;
  if (opts.checkOps) {
    summaryJson = await requestJson(opts, `/api/factory/reels-brain/summary?niche=${encodeURIComponent(opts.niche)}`);
    digestAll = await requestJson(opts, `/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(opts.portfolioNiches.join(","))}`);
    ops = await requestJson(opts, "/api/factory/ops");

    console.log("");
    console.log("summary:");
    console.table((summaryJson.platforms || []).map((platform) => ({
      platform: platform.platform,
      status: platform.status,
      readiness: platform.training_readiness?.score ?? 0,
      preferred_provider: platform.preferred_provider?.provider || "none",
      alerts: Array.isArray(platform.alerts) ? platform.alerts.length : 0,
    })));

    console.log("");
    console.log("portfolio:");
    console.table(compactPortfolio(Array.isArray(digestAll.niches) ? digestAll.niches : []));

    console.log("");
    console.log("ops:");
    console.table([{
      ops_level: ops.ops_status?.level || "unknown",
      ops_summary: ops.ops_status?.summary || "none",
      reels_ready_niches: ops.reels_brain?.portfolio?.ready_niches ?? 0,
      reels_watch_niches: ops.reels_brain?.portfolio?.watch_niches ?? 0,
      reels_avg_readiness: ops.reels_brain?.portfolio?.avg_readiness ?? 0,
    }]);
  }
  if (opts.checkGrowth) {
    growth = await requestJson(opts, `/api/factory/jobs/reels-brain-growth?niches=${encodeURIComponent(opts.portfolioNiches.join(","))}&platforms=tiktok,instagram,youtube&max_lanes=3`);
    console.log("");
    console.log("growth queue:");
    console.table(compactGrowthQueue(Array.isArray(growth.queue) ? growth.queue : []));
  }
  if (opts.checkBulk) {
    bulk = await requestJson(opts, `/api/factory/jobs/reels-brain-bulk-ingest?niches=${encodeURIComponent(opts.portfolioNiches.join(","))}&platforms=tiktok,instagram,youtube&max_lanes=3&providers_per_lane=2&limit=25`);
    console.log("");
    console.log("bulk ingest queue:");
    console.table(compactGrowthQueue(Array.isArray(bulk.queue) ? bulk.queue : []));
  }

  if (opts.json) {
    console.log(JSON.stringify({ providersHealth, bakeOff, summaryJson, digestAll, ops, growth, bulk }, null, 2));
  }

  if (!opts.allowEmpty && valid < 1) {
    console.error("Smoke finished, but no valid videos were returned.");
    process.exit(4);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
