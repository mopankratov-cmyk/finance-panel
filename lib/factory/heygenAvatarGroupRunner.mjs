import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEYGEN_ENDPOINTS,
  buildAvatarGroupPlan,
  buildGroupAddPayload,
  buildGroupCreatePayload,
  buildLookGeneratePayload,
  buildTrainPayload,
} from "./heygenAvatarGroup.ts";

const API_BASE = "https://api.heygen.com";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-face-foundry/heygen";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function boolArg(name) {
  return argValue(name, "false") === "true";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiKey() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY is required");
  return key;
}

async function fetchRetry(url, init = {}, tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      last = e;
      await sleep(1200 * i);
    }
  }
  throw last;
}

async function api(path, key, init = {}) {
  const res = await fetchRetry(`${API_BASE}${path}`, {
    ...init,
    headers: { "x-api-key": key, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`heygen ${path} ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

async function uploadAsset(localPath, key) {
  const bytes = readFileSync(localPath);
  const res = await fetchRetry(HEYGEN_ENDPOINTS.uploadAsset, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "image/png" },
    body: bytes,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`heygen upload ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  const imageKey = data?.data?.image_key || data?.data?.key || data?.image_key;
  if (!imageKey) throw new Error(`upload without image_key: ${JSON.stringify(data).slice(0, 400)}`);
  return imageKey;
}

function statePaths(persona, outRoot) {
  const dir = join(outRoot, persona);
  return { dir, state: join(dir, "state.json") };
}

function loadState(statePath) {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function loadAcceptedAngles(anglesDir, excludeCsv) {
  const resultsPath = join(anglesDir, "results-sanitized.json");
  const rows = JSON.parse(readFileSync(resultsPath, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${resultsPath} must be an array`);
  const exclude = new Set(String(excludeCsv || "").split(",").map((s) => s.trim()).filter(Boolean));
  return rows
    .filter((r) => r.ok && r.local_path && !exclude.has(r.spec_id))
    .map((r) => ({ spec_id: r.spec_id, local_path: r.local_path }));
}

async function stageUpload(plan, state, key) {
  state.uploads = state.uploads || {};
  for (const angle of plan.angles) {
    if (state.uploads[angle.spec_id]) continue;
    console.log(`UPLOAD ${basename(angle.local_path)}`);
    state.uploads[angle.spec_id] = await uploadAsset(angle.local_path, key);
  }
  return state;
}

async function stageGroup(plan, state, key) {
  const keys = plan.angles.map((a) => state.uploads?.[a.spec_id]).filter(Boolean);
  if (keys.length !== plan.angles.length) throw new Error("run --stage upload first (missing image_keys)");
  if (!state.group_id) {
    console.log(`GROUP CREATE ${plan.group_name}`);
    const created = await api(HEYGEN_ENDPOINTS.groupCreate, key, {
      method: "POST",
      body: JSON.stringify(buildGroupCreatePayload(plan.group_name, keys[0])),
    });
    state.group_id = created?.data?.group_id || created?.data?.id;
    if (!state.group_id) throw new Error(`group create without group_id: ${JSON.stringify(created).slice(0, 300)}`);
    state.creation_key = keys[0];
  }
  // HeyGen API accepts max 4 image_keys per add call; creation_key may be an
  // externally uploaded hero photo that is not part of the angles set
  state.added_keys = state.added_keys || [];
  const pending = keys.filter((k) => k !== state.creation_key && !state.added_keys.includes(k));
  state.skipped_keys = state.skipped_keys || [];
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    console.log(`GROUP ADD batch of ${batch.length}`);
    try {
      await api(HEYGEN_ENDPOINTS.groupAdd, key, {
        method: "POST",
        body: JSON.stringify(buildGroupAddPayload(state.group_id, batch)),
      });
      state.added_keys.push(...batch);
    } catch (error) {
      // one rejected photo (e.g. identity mismatch) fails the whole batch — retry per key
      console.log(`GROUP ADD batch failed, retrying per key: ${String(error?.message || error).slice(0, 160)}`);
      for (const k of batch) {
        try {
          await api(HEYGEN_ENDPOINTS.groupAdd, key, {
            method: "POST",
            body: JSON.stringify(buildGroupAddPayload(state.group_id, [k])),
          });
          state.added_keys.push(k);
        } catch (singleError) {
          console.log(`GROUP ADD skipped ${k}: ${String(singleError?.message || singleError).slice(0, 160)}`);
          state.skipped_keys.push({ key: k, error: String(singleError?.message || singleError).slice(0, 200) });
        }
      }
    }
  }
  state.group_added = true;
  return state;
}

async function stageTrain(plan, state, key) {
  if (!state.group_id) throw new Error("run --stage group first");
  if (!state.train_started) {
    console.log(`TRAIN ${state.group_id}`);
    await api(HEYGEN_ENDPOINTS.train, key, { method: "POST", body: JSON.stringify(buildTrainPayload(state.group_id)) });
    state.train_started = true;
  }
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const st = await api(HEYGEN_ENDPOINTS.trainStatus(state.group_id), key);
    const status = st?.data?.status || st?.status || "unknown";
    console.log(`TRAIN STATUS ${status}`);
    if (status === "ready" || status === "success" || status === "completed") {
      state.train_ready = true;
      return state;
    }
    if (status === "failed" || status === "error") throw new Error(`train failed: ${JSON.stringify(st).slice(0, 300)}`);
    await sleep(15_000);
  }
  throw new Error("train wait timeout after 20min — re-run --stage train later, state is saved");
}

async function download(url, dest) {
  const res = await fetchRetry(url, {}, 3);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function stageLooks(plan, state, key, outDir) {
  if (!state.train_ready) throw new Error("run --stage train first (group must be ready)");
  state.looks = state.looks || {};
  for (const look of plan.looks) {
    if (state.looks[look.look_id]?.ok) continue;
    console.log(`LOOK ${look.look_id}`);
    try {
      const gen = await api(HEYGEN_ENDPOINTS.lookGenerate, key, {
        method: "POST",
        body: JSON.stringify(buildLookGeneratePayload(state.group_id, look)),
      });
      const generationId = gen?.data?.generation_id || gen?.data?.id;
      if (!generationId) throw new Error(`look generate without generation_id: ${JSON.stringify(gen).slice(0, 300)}`);
      let imageUrls = [];
      let imageKeys = [];
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await sleep(8000);
        const st = await api(HEYGEN_ENDPOINTS.generationStatus(generationId), key);
        const status = st?.data?.status || "unknown";
        console.log(`LOOK STATUS ${look.look_id} ${status}`);
        if (status === "success" || status === "completed" || status === "ready") {
          imageUrls = st?.data?.image_url_list || [];
          imageKeys = st?.data?.image_key_list || [];
          break;
        }
        if (status === "failed" || status === "error") throw new Error(`look generation failed: ${JSON.stringify(st).slice(0, 300)}`);
      }
      if (!imageUrls.length) throw new Error(`look ${look.look_id}: no images after wait`);
      const localPath = join(outDir, `${look.look_id}.png`);
      await download(imageUrls[0], localPath);
      state.looks[look.look_id] = { ok: true, generation_id: generationId, image_keys: imageKeys, image_urls: imageUrls, local_path: localPath, scene_id: look.scene_id };
      console.log(`DOWNLOADED ${basename(localPath)}`);
    } catch (error) {
      state.looks[look.look_id] = { ok: false, error: String(error?.message || error).slice(0, 400) };
    }
  }
  return state;
}

async function stageLooksExternal(state, key, looksDir) {
  if (!state.train_ready) throw new Error("group must be trained before adding looks (run --stage train)");
  const resultsPath = join(looksDir, "results-sanitized.json");
  const rows = JSON.parse(readFileSync(resultsPath, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${resultsPath} must be an array`);
  const exclude = new Set(String(argValue("--exclude", "")).split(",").map((s) => s.trim()).filter(Boolean));
  const accepted = rows.filter((r) => r.ok && r.local_path && !exclude.has(r.spec_id));
  state.external_looks = state.external_looks || {};
  for (const row of accepted) {
    if (state.external_looks[row.spec_id]?.ok) continue;
    console.log(`LOOK UPLOAD ${row.spec_id}`);
    try {
      const imageKey = await uploadAsset(row.local_path, key);
      await api(HEYGEN_ENDPOINTS.groupAdd, key, {
        method: "POST",
        body: JSON.stringify(buildGroupAddPayload(state.group_id, [imageKey], row.spec_id)),
      });
      state.external_looks[row.spec_id] = { ok: true, image_key: imageKey };
    } catch (error) {
      state.external_looks[row.spec_id] = { ok: false, error: String(error?.message || error).slice(0, 300) };
      console.log(`LOOK FAILED ${row.spec_id}: ${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return state;
}

async function main() {
  const persona = argValue("--persona", "");
  if (!persona) throw new Error("--persona manya|vika|olya is required");
  const displayName = { manya: "Маня", vika: "Вика", olya: "Оля" }[persona] || persona;
  const stage = argValue("--stage", "plan");
  const outRoot = argValue("--out-dir", DEFAULT_OUT_DIR);
  const anglesDir = argValue("--angles-dir", `/tmp/ugc-factory-face-foundry/angles/face_hero__${persona}__unknown`);
  const lookCount = Number(argValue("--look-count", "14"));

  const angles = loadAcceptedAngles(anglesDir, argValue("--exclude", ""));
  const plan = buildAvatarGroupPlan(persona, displayName, angles, lookCount);
  const { dir, state: statePath } = statePaths(persona, outRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  if (!plan.ok) throw new Error(plan.warnings.join("; "));

  if (stage === "plan") {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", persona, plan_path: join(dir, "plan.json"), angles: plan.angles.length, looks: plan.looks.length }, null, 2));
    return;
  }

  const key = apiKey();
  let state = loadState(statePath);
  try {
    if (stage === "upload" || stage === "all") state = await stageUpload(plan, state, key);
    if (stage === "group" || stage === "all") state = await stageGroup(plan, state, key);
    if (stage === "train" || stage === "all") state = await stageTrain(plan, state, key);
    if (stage === "looks-external") {
      state = await stageLooksExternal(state, key, argValue("--looks-dir", `/tmp/ugc-factory-face-foundry/looks/${persona}`));
    }
    if (stage === "looks" || stage === "all") {
      if (!boolArg("--confirm-paid")) {
        console.log(JSON.stringify({ ok: true, mode: "dry-run", note: "looks burn credits — pass --confirm-paid true", persona }, null, 2));
      } else {
        state = await stageLooks(plan, state, key, dir);
      }
    }
  } finally {
    saveState(statePath, state);
  }
  const looksOk = Object.values(state.looks || {}).filter((l) => l.ok).length;
  console.log(JSON.stringify({ ok: true, persona, stage, group_id: state.group_id || null, train_ready: !!state.train_ready, uploads: Object.keys(state.uploads || {}).length, looks_ok: looksOk, state_path: statePath }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack || error));
    process.exit(1);
  });
}
