import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKatyaAnchorExpansion } from "./bloggerAnchorExpansion.ts";
import { buildHeyGenPayload } from "./bloggerLearningLoopRunner.mjs";

const BASE = "https://api.heygen.com";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-katya-anchor-expansion";

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
  const data = text ? JSON.parse(text) : {};
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
      throw new Error(`HeyGen failed ${run.run_id}`);
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
    local_path: localPath,
    scene_id: run.scene_id,
    avatar_look_label: run.avatar_look_label,
    pose_id: run.pose_id,
    expression_id: run.expression_id,
    motion_preset: run.motion_preset,
    hypothesis: run.hypothesis,
  };
}

async function main() {
  const generation = intArg("--generation", 13, 1, 99);
  const outRoot = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outDir = join(outRoot, `generation-${String(generation).padStart(2, "0")}`);
  mkdirSync(outDir, { recursive: true });
  const plan = buildKatyaAnchorExpansion(generation);
  writeFileSync(join(outDir, "planned-runs.json"), JSON.stringify(plan, null, 2));
  if (!boolArg("--confirm-paid")) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", planned_path: join(outDir, "planned-runs.json") }, null, 2));
    return;
  }
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is required");
  const results = [];
  for (const run of plan.planned_runs) {
    console.log(`CREATE ${run.run_id}`);
    try {
      const result = await renderRun(run, apiKey, outDir);
      results.push(result);
      console.log(`DOWNLOADED ${basename(result.local_path)}`);
    } catch (error) {
      results.push({ ok: false, run_id: run.run_id, error: String(error?.message || error).slice(0, 500) });
    }
  }
  const resultPath = join(outDir, "results-sanitized.json");
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, result_path: resultPath, out_dir: outDir, count: results.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack || error));
    process.exit(1);
  });
}
