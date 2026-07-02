import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { autoSelectKatyaGeneration } from "./bloggerLearningAutoSelect.ts";
import { buildKatyaLearningLoop } from "./bloggerLearningLoop.ts";
import { buildHeyGenPayload, selectGenerationRuns } from "./bloggerLearningLoopRunner.mjs";

const BASE = "https://api.heygen.com";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-katya-autopilot";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function intArg(name, fallback, min, max) {
  const n = Number(argValue(name, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function boolArg(name) {
  return argValue(name, "false") === "true";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUrl(url) {
  return typeof url === "string" ? url.split("?")[0] : url;
}

function readPriorResults(file) {
  if (!file) return [];
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(raw) ? raw : Array.isArray(raw.prior_results) ? raw.prior_results : [];
}

async function request(path, apiKey, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

async function renderRun(run, apiKey, outDir) {
  const payload = buildHeyGenPayload(run);
  if (!payload.avatar_id) throw new Error(`missing avatar_id for ${run.run_id}`);
  if (!payload.voice_id) throw new Error(`missing voice_id for ${run.run_id}`);
  const create = await request("/v3/videos", apiKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const videoId = create?.data?.video_id || create?.video_id || create?.id;
  if (!videoId) throw new Error(`missing HeyGen video id for ${run.run_id}`);

  let status = null;
  for (let attempt = 0; attempt < 90; attempt++) {
    await sleep(attempt < 5 ? 5000 : 8000);
    status = await request(`/v3/videos/${encodeURIComponent(videoId)}`, apiKey);
    const data = status?.data || status;
    const state = data?.status || data?.state || data?.video_status;
    console.log(`STATUS ${run.run_id} ${state || "unknown"} attempt=${attempt + 1}`);
    if (state === "completed" || state === "success" || data?.video_url) break;
    if (state === "failed" || state === "error") {
      const code = data?.failure_code ? ` ${data.failure_code}` : "";
      const message = data?.failure_message ? `: ${data.failure_message}` : "";
      throw new Error(`HeyGen failed ${run.run_id}${code}${message}`);
    }
  }

  const data = status?.data || status || {};
  const videoUrl = data.video_url || data.url || data.output_url;
  if (!videoUrl) throw new Error(`no video url for ${run.run_id}`);
  const localPath = join(outDir, `${run.run_id}.mp4`);
  await download(videoUrl, localPath);

  return {
    ok: true,
    run_id: run.run_id,
    generation: run.generation,
    sequence: run.sequence,
    heygen_video_id: videoId,
    status: data.status || data.state || data.video_status || null,
    local_path: localPath,
    video_url_clean: cleanUrl(videoUrl),
    thumbnail_url_clean: cleanUrl(data.thumbnail_url),
    scene_id: run.scene_id,
    camera_angle_id: run.camera_angle_id,
    pose_id: run.pose_id,
    expression_id: run.expression_id,
    motion_preset: run.motion_preset,
    expressiveness: run.expressiveness,
    script: run.script,
    motion_prompt: run.heygen_motion_prompt,
  };
}

function writeRepoPrior(repoDir, generation, priorResults) {
  if (!repoDir) return null;
  const path = resolve(repoDir, `factory-katya-generation${generation}-prior-results.json`);
  writeFileSync(path, `${JSON.stringify({ prior_results: priorResults }, null, 2)}\n`);
  return path;
}

async function runGeneration({ generation, priorResults, outRoot, apiKey, topK, repoPriorDir }) {
  const outDir = join(outRoot, `generation-${String(generation).padStart(2, "0")}`);
  mkdirSync(outDir, { recursive: true });
  const plan = buildKatyaLearningLoop({
    blogger_id: "katya_russian_creator_v3b",
    target_runs: 5,
    generation_size: 5,
    start_generation: generation,
    prior_results: priorResults,
  });
  const runs = selectGenerationRuns(plan, generation, 5);
  writeFileSync(join(outDir, "planned-runs.json"), JSON.stringify({ plan: { ...plan, planned_runs: runs }, runs }, null, 2));

  const results = [];
  for (const run of runs) {
    console.log(`CREATE ${run.run_id}`);
    try {
      const result = await renderRun(run, apiKey, outDir);
      results.push(result);
      console.log(`DOWNLOADED ${basename(result.local_path)}`);
    } catch (error) {
      results.push({
        ok: false,
        run_id: run.run_id,
        generation: run.generation,
        sequence: run.sequence,
        error: String(error?.message || error).slice(0, 500),
      });
      console.log(`FAILED ${run.run_id}`);
    }
  }

  const resultPath = join(outDir, "results-sanitized.json");
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  const auto = autoSelectKatyaGeneration({
    plan,
    results,
    generation,
    top_k: topK,
  });
  const autoPath = join(outDir, "auto-prior-results.json");
  writeFileSync(autoPath, JSON.stringify(auto, null, 2));
  const repoPriorPath = writeRepoPrior(repoPriorDir, generation + 1, auto.prior_results);

  return {
    generation,
    out_dir: outDir,
    results_path: resultPath,
    auto_path: autoPath,
    repo_prior_path: repoPriorPath,
    winners: auto.winners,
    confidence: auto.confidence,
    needs_human_review: auto.needs_human_review,
    ranked: auto.ranked,
  };
}

async function main() {
  const startGeneration = intArg("--start-generation", 7, 1, 99);
  const count = intArg("--count", 2, 1, 10);
  const topK = intArg("--auto-top-k", 2, 1, 5);
  const outRoot = argValue("--out-dir", DEFAULT_OUT_DIR);
  const priorResultsFile = argValue("--prior-results-file");
  const repoPriorDir = argValue("--repo-prior-dir");
  const confirmPaid = boolArg("--confirm-paid");
  if (!confirmPaid) {
    throw new Error("Pass --confirm-paid true to run autopilot.");
  }
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is required");

  let priorResults = readPriorResults(priorResultsFile);
  const summary = [];
  for (let step = 0; step < count; step++) {
    const generation = startGeneration + step;
    const generationSummary = await runGeneration({
      generation,
      priorResults,
      outRoot,
      apiKey,
      topK,
      repoPriorDir,
    });
    summary.push(generationSummary);
    priorResults = JSON.parse(readFileSync(generationSummary.auto_path, "utf8")).prior_results || [];
  }

  const summaryPath = join(outRoot, "autopilot-summary.json");
  writeFileSync(summaryPath, JSON.stringify({
    ok: true,
    start_generation: startGeneration,
    count,
    generations: summary,
  }, null, 2));
  console.log(JSON.stringify({ ok: true, summary_path: summaryPath, generations: summary.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack || error));
    process.exit(1);
  });
}
