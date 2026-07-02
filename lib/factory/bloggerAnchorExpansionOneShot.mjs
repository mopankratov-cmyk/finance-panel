import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHeyGenPayload } from "./bloggerLearningLoopRunner.mjs";

const BASE = "https://api.heygen.com";

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
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
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

async function main() {
  const plannedPath = argValue("--planned-path");
  const sequence = intArg("--sequence", 1, 1, 20);
  const outDir = argValue("--out-dir");
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!plannedPath) throw new Error("--planned-path is required");
  if (!outDir) throw new Error("--out-dir is required");
  if (!apiKey) throw new Error("HEYGEN_API_KEY is required");
  mkdirSync(outDir, { recursive: true });

  const raw = JSON.parse(readFileSync(plannedPath, "utf8"));
  const runs = raw.planned_runs || raw.runs || [];
  const run = runs.find((item) => Number(item.sequence) === sequence);
  if (!run) throw new Error(`sequence ${sequence} not found`);

  const payload = buildHeyGenPayload(run);
  console.log(`CREATE ${run.run_id}`);
  const create = await request("/v3/videos", apiKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const videoId = create?.data?.video_id || create?.video_id || create?.id;
  if (!videoId) throw new Error(`missing video id for ${run.run_id}`);

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
  console.log(JSON.stringify({ ok: true, run_id: run.run_id, local_path: localPath }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack || error));
    process.exit(1);
  });
}
