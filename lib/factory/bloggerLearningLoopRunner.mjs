import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { autoSelectKatyaGeneration } from "./bloggerLearningAutoSelect.ts";
import { buildKatyaLearningLoop } from "./bloggerLearningLoop.ts";

const BASE = "https://api.heygen.com";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-katya-learning-loop";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function boolArg(name) {
  return argValue(name, "false") === "true";
}

function intArg(name, fallback, min, max) {
  const n = Number(argValue(name, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUrl(url) {
  return typeof url === "string" ? url.split("?")[0] : url;
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

function selectGenerationRuns(plan, generation, limit) {
  return plan.planned_runs
    .filter((run) => run.generation === generation)
    .slice(0, limit);
}

function readPriorResults(file) {
  if (!file) return [];
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(raw) ? raw : Array.isArray(raw.prior_results) ? raw.prior_results : [];
}

function buildHeyGenPayload(run) {
  return {
    type: "avatar",
    avatar_id: run.avatar_look_id,
    title: `Katya actor loop ${run.run_id}`,
    aspect_ratio: "9:16",
    resolution: "720p",
    output_format: "mp4",
    script: run.script,
    voice_id: run.voice_id,
    voice_settings: { speed: 0.94, pitch: 0, volume: 1 },
    engine: { type: "avatar_iv" },
    motion_prompt: run.heygen_motion_prompt,
    expressiveness: run.expressiveness,
  };
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
    note: "Fixed HeyGen avatar look mainly tests movement/expression. Different room/angle/pose require separate Katya source looks.",
  };
}

async function main() {
  const generation = intArg("--generation", 1, 1, 50);
  const limit = intArg("--limit", 5, 1, 5);
  const targetRuns = intArg("--target-runs", 100, 1, 160);
  const generationSize = intArg("--generation-size", 5, 4, 20);
  const confirmPaid = boolArg("--confirm-paid");
  const autoSelect = boolArg("--auto-select");
  const autoTopK = intArg("--auto-top-k", 2, 1, 5);
  const priorResultsFile = argValue("--prior-results-file");
  const outRoot = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outDir = join(outRoot, `generation-${String(generation).padStart(2, "0")}`);
  mkdirSync(outDir, { recursive: true });
  const priorResults = readPriorResults(priorResultsFile);

  const plan = buildKatyaLearningLoop({
    blogger_id: "katya_russian_creator_v3b",
    target_runs: targetRuns,
    generation_size: generationSize,
    start_generation: generation,
    prior_results: priorResults,
  });
  const runs = selectGenerationRuns(plan, generation, limit);
  const plannedPath = join(outDir, "planned-runs.json");
  writeFileSync(plannedPath, JSON.stringify({ plan: { ...plan, planned_runs: runs }, runs }, null, 2));

  if (!confirmPaid) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      planned_path: plannedPath,
      out_dir: outDir,
      count: runs.length,
      warning: "No paid HeyGen calls were made. Pass --confirm-paid true to render this generation.",
    }, null, 2));
    return;
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is required for --confirm-paid true");

  const results = [];
  for (const run of runs) {
    console.log(`CREATE ${run.run_id}`);
    try {
      const result = await renderRun(run, apiKey, outDir);
      results.push(result);
      console.log(`DOWNLOADED ${result.local_path}`);
    } catch (e) {
      results.push({
        ok: false,
        run_id: run.run_id,
        generation: run.generation,
        sequence: run.sequence,
        error: String(e?.message || e).slice(0, 500),
      });
      console.log(`FAILED ${run.run_id}`);
    }
  }

  const resultPath = join(outDir, "results-sanitized.json");
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  let autoSelectionPath = null;
  if (autoSelect) {
    const autoSelection = autoSelectKatyaGeneration({
      plan,
      results,
      generation,
      top_k: autoTopK,
    });
    autoSelectionPath = join(outDir, "auto-prior-results.json");
    writeFileSync(autoSelectionPath, JSON.stringify(autoSelection, null, 2));
  }
  console.log(JSON.stringify({
    ok: true,
    mode: "paid-render",
    out_dir: outDir,
    result_path: resultPath,
    auto_selection_path: autoSelectionPath,
    count: results.length,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
  });
}

export { buildHeyGenPayload, selectGenerationRuns };
