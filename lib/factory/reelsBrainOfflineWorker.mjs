#!/usr/bin/env node

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[arg.slice(2)] = next;
      i += 1;
    } else {
      opts[arg.slice(2)] = true;
    }
  }
  return opts;
}

function usage() {
  console.log(`Usage:
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainOfflineWorker.mjs --once
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER=1 node lib/factory/reelsBrainOfflineWorker.mjs --every-sec=180

Options:
  --base <url>                 Override BASE_URL
  --secret <token>             Override CRON_SECRET
  --mode <media|audio|mixed>   Worker mode (default: media)
  --provider <name>            Provider for media backfill (default: apify_instagram)
  --platform <name>            Platform to backfill (default: instagram)
  --niches <csv>               Niche list (default: ru_toys,ru_clothing,ru_cosmetics)
  --limit <n>                  Rows per cycle (default: 3)
  --scan <n>                   Scan window per cycle (default: 30)
  --transcribe <0|1>           Enable transcript step in audio mode (default: 1)
  --language <code>            Transcript language in audio mode (default: ru)
  --every-sec <n>              Loop interval in seconds
  --max-cycles <n>             Stop after N cycles
  --once                       Run one cycle and exit
  --use-local-resolver <0|1>   Force yt-dlp resolver flag in API call
  --heartbeat <0|1>            Send worker-state heartbeats (default: 1)
  --worker-id <id>             Worker id (default: reels-brain-offline-worker)
  --label <text>               Worker label
  --task-id <id>               Worker task id
  --task-title <text>          Worker task title
  --help                       Show help
`);
}

function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boolFlag(value, fallback = false) {
  if (value == null) return fallback;
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function intFlag(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasYtDlpBinary() {
  const home = os.homedir();
  const candidates = [
    toText(process.env.YT_DLP_BIN),
    "yt-dlp",
    path.join(home, ".local/bin/yt-dlp"),
    path.join(home, "Library/Python/3.14/bin/yt-dlp"),
    path.join(home, "Library/Python/3.13/bin/yt-dlp"),
    path.join(home, "Library/Python/3.12/bin/yt-dlp"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000, maxBuffer: 256 * 1024 });
      return candidate;
    } catch {}
  }
  return "";
}

function pickFormatUrl(payload) {
  const direct = toText(payload?.url);
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const requested = Array.isArray(payload?.requested_formats) ? payload.requested_formats : [];
  for (const format of requested) {
    const url = toText(format?.url);
    if (url && /^https?:\/\//i.test(url)) return url;
  }

  const formats = Array.isArray(payload?.formats) ? payload.formats : [];
  for (const format of [...formats].reverse()) {
    const url = toText(format?.url);
    const ext = toText(format?.ext);
    const vcodec = toText(format?.vcodec);
    if (url && /^https?:\/\//i.test(url) && (ext === "mp4" || (vcodec && vcodec !== "none"))) return url;
  }

  return null;
}

async function resolveMediaLocatorViaYtDlp(url) {
  const target = toText(url);
  const binary = toText(process.env.YT_DLP_BIN) || await hasYtDlpBinary();
  if (!target || !binary) return null;
  try {
    const { stdout } = await execFileAsync(
      binary,
      ["-J", "--no-warnings", "--skip-download", target],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout);
    const mediaUrl = pickFormatUrl(payload);
    if (!mediaUrl) return null;
    return {
      media_url: mediaUrl,
      title: toText(payload?.title),
      author: toText(payload?.uploader) || toText(payload?.channel),
      duration_sec: Number.isFinite(Number(payload?.duration)) ? Number(payload.duration) : null,
      extractor: toText(payload?.extractor_key) || toText(payload?.extractor),
      source: "yt_dlp",
    };
  } catch {
    return null;
  }
}

async function fetchJson(url, init = {}, timeoutMs = 115_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function heartbeatPayload(config, progress, note, blocker = "") {
  return {
    worker_id: config.workerId,
    label: config.label,
    status: blocker ? "blocked" : "working",
    branch: toText(process.env.WORKER_BRANCH || ""),
    pr: toText(process.env.WORKER_PR || ""),
    current_task_id: config.taskId,
    current_task_title: config.taskTitle,
    progress,
    blocker,
    note,
    queue: [],
  };
}

async function postHeartbeat(config, progress, note, blocker = "") {
  if (!config.heartbeat) return;
  const payload = heartbeatPayload(config, progress, note, blocker);
  const response = await fetchJson(`${config.baseUrl}/api/factory/worker-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(payload),
  }, 15_000);
  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      stage: "heartbeat",
      status: response.status,
      body: response.json,
    }));
  }
}

async function runCycle(config, cycle) {
  const mode = config.mode === "mixed"
    ? (cycle % 2 === 1 ? "media" : "audio")
    : config.mode;
  const route = mode === "audio"
    ? "/api/factory/jobs/reels-brain-audio-backfill"
    : "/api/factory/jobs/reels-brain-media-backfill";
  const url = new URL(route, config.baseUrl);
  url.searchParams.set("platform", config.platform);
  url.searchParams.set("niches", config.niches);
  const limit = mode === "audio" ? config.audioLimit : config.mediaLimit;
  const scan = mode === "audio" ? config.audioScan : config.mediaScan;
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("scan", String(scan));
  if (mode === "audio") {
    url.searchParams.set("transcribe", config.transcribe ? "1" : "0");
    url.searchParams.set("language", config.language);
  } else {
    url.searchParams.set("provider", config.provider);
    url.searchParams.set("use_local_resolver", config.useLocalResolver ? "1" : "0");
  }

  await postHeartbeat(
    config,
    `cycle ${cycle}: ${config.platform} ${mode} backfill`,
    mode === "audio"
      ? `transcribe=${config.transcribe ? "on" : "off"} limit=${limit} scan=${scan}`
      : `provider=${config.provider} limit=${limit} scan=${scan}`,
  );

  const result = await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${config.secret}` },
  });

  const body = result.json && typeof result.json === "object" ? result.json : {};
  const runs = Array.isArray(body.runs) ? body.runs : [];
  let locallyResolved = 0;

  if (mode === "media" && config.useLocalResolver && config.localResolverAvailable) {
    for (const run of runs) {
      const targetUrl = toText(run?.url);
      const rowId = Number(run?.id || 0);
      const matchedWithMedia = Number(run?.matched_with_media || 0) || 0;
      if (!targetUrl || !rowId || matchedWithMedia > 0) continue;

      const resolved = await resolveMediaLocatorViaYtDlp(targetUrl);
      if (!resolved?.media_url) continue;

      const commit = await fetchJson(`${config.baseUrl}/api/factory/jobs/reels-brain-media-commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify({
          id: rowId,
          url: targetUrl,
          platform: config.platform,
          media_url: resolved.media_url,
          title: resolved.title,
          author: resolved.author,
          duration_sec: resolved.duration_sec,
        }),
      });
      if (commit.ok) locallyResolved += 1;
    }
  }

  const attempted = Number(body.attempted || 0) || 0;
  const withMedia = Number(body.rows_with_media || 0) || 0;
  const enriched = Number(body.enriched || 0) || 0;
  const inserted = Number(body.inserted || 0) || 0;
  const extracted = Number(body.extracted || 0) || 0;
  const transcriptReady = Number(body.transcript_ready || 0) || 0;
  const note = mode === "audio"
    ? `attempted=${attempted} extracted=${extracted} transcript_ready=${transcriptReady} failed=${Number(body.failed || 0) || 0}`
    : `attempted=${attempted} with_media=${withMedia} enriched=${enriched} inserted=${inserted} local_commits=${locallyResolved}`;
  await postHeartbeat(config, `cycle ${cycle}: completed`, note, result.ok ? "" : `http_${result.status}`);

  console.log(JSON.stringify({
    ok: result.ok,
    cycle,
    mode,
    provider: config.provider,
    platform: config.platform,
    attempted,
    with_media: withMedia,
    enriched,
    inserted,
    extracted,
    transcript_ready: transcriptReady,
    local_commits: locallyResolved,
    local_resolver_enabled: body.local_resolver_enabled || false,
    local_resolver_available: config.localResolverAvailable,
    sample: runs.slice(0, 2),
    status: result.status,
  }));

  return { ok: result.ok, body };
}

const opts = parseArgs(process.argv);
if (opts.help) {
  usage();
  process.exit(0);
}

const config = {
  baseUrl: String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, ""),
  secret: String(opts.secret || process.env.CRON_SECRET || ""),
  mode: (() => {
    const raw = toText(opts.mode || process.env.REELS_BRAIN_OFFLINE_MODE || "media");
    return raw === "audio" || raw === "mixed" ? raw : "media";
  })(),
  provider: toText(opts.provider || process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER || "apify_instagram"),
  platform: toText(opts.platform || process.env.REELS_BRAIN_MEDIA_BACKFILL_PLATFORM || "instagram"),
  niches: toText(opts.niches || process.env.REELS_BRAIN_NICHES || "ru_toys,ru_clothing,ru_cosmetics"),
  limit: intFlag(opts.limit || process.env.REELS_BRAIN_MEDIA_BACKFILL_LIMIT || 3, 3, 1, 10),
  scan: intFlag(opts.scan || process.env.REELS_BRAIN_MEDIA_BACKFILL_SCAN || 30, 30, 1, 200),
  mediaLimit: intFlag(opts["media-limit"] || process.env.REELS_BRAIN_MEDIA_BACKFILL_LIMIT || 3, 3, 1, 10),
  mediaScan: intFlag(opts["media-scan"] || process.env.REELS_BRAIN_MEDIA_BACKFILL_SCAN || 30, 30, 1, 200),
  audioLimit: intFlag(opts["audio-limit"] || process.env.REELS_BRAIN_AUDIO_BACKFILL_LIMIT || 2, 2, 1, 8),
  audioScan: intFlag(opts["audio-scan"] || process.env.REELS_BRAIN_AUDIO_BACKFILL_SCAN || 18, 18, 1, 120),
  transcribe: boolFlag(opts.transcribe ?? process.env.REELS_BRAIN_AUDIO_TRANSCRIBE ?? "1", true),
  language: toText(opts.language || process.env.REELS_BRAIN_AUDIO_LANGUAGE || "ru") || "ru",
  everySec: intFlag(opts["every-sec"] || process.env.REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC || 0, 0, 0, 86_400),
  maxCycles: intFlag(opts["max-cycles"] || process.env.REELS_BRAIN_OFFLINE_MAX_CYCLES || 0, 0, 0, 100_000),
  once: boolFlag(opts.once, false),
  useLocalResolver: boolFlag(opts["use-local-resolver"] ?? process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER, false),
  heartbeat: boolFlag(opts.heartbeat ?? process.env.REELS_BRAIN_OFFLINE_HEARTBEAT ?? "1", true),
  workerId: toText(opts["worker-id"] || process.env.WORKER_ID || "reels-brain-offline-worker"),
  label: toText(opts.label || process.env.WORKER_LABEL || "Reels Brain Offline Worker"),
  taskId: toText(opts["task-id"] || process.env.WORKER_TASK_ID || "RB-OFFLINE-001"),
  taskTitle: toText(opts["task-title"] || process.env.WORKER_TASK_TITLE || "Media locator backfill via offline worker"),
};

if (!config.baseUrl) {
  console.error("BASE_URL is required");
  process.exit(1);
}
if (!config.secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

config.localResolverBinary = config.useLocalResolver ? await hasYtDlpBinary() : "";
config.localResolverAvailable = Boolean(config.localResolverBinary);
if (config.localResolverBinary) {
  process.env.YT_DLP_BIN = config.localResolverBinary;
}

if (!config.everySec || config.once) {
  await runCycle(config, 1);
  process.exit(0);
}

let cycle = 0;
while (true) {
  cycle += 1;
  try {
    await runCycle(config, cycle);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 220);
    await postHeartbeat(config, `cycle ${cycle}: failed`, "offline worker cycle failed", message);
    console.error(JSON.stringify({ ok: false, cycle, error: message }));
  }
  if (config.maxCycles > 0 && cycle >= config.maxCycles) break;
  await sleep(config.everySec * 1000);
}
