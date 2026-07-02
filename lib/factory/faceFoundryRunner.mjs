import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFaceAnglePlan, buildFaceHeroPlan } from "./faceFoundry.ts";
import { buildAvatarGroupLooks } from "./heygenAvatarGroup.ts";

const QUEUE = "https://queue.fal.run/";
const STORAGE_INITIATE = "https://rest.alpha.fal.ai/storage/upload/initiate";
const HERO_MODEL = "fal-ai/nano-banana";
const ANGLE_MODEL = "fal-ai/nano-banana/edit";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-face-foundry";

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

function falKey() {
  const key = process.env.FAL_KEY || process.env.FAL_BILLING_KEY || "";
  if (!key) throw new Error("FAL_KEY or FAL_BILLING_KEY is required");
  return key;
}

async function fetchWithRetry(url, init = {}, tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      last = e;
      await sleep(1200 * i);
    }
  }
  throw last;
}

async function falQueueRun(model, body, apiKey, maxWaitMs = 230_000) {
  const sub = await fetchWithRetry(`${QUEUE}${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!sub.ok) throw new Error(`fal submit ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  const sj = await sub.json();
  const responseUrl = sj.response_url || "";
  if (!responseUrl) throw new Error("fal submit without response_url");

  let completed = false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    try {
      const st = await fetchWithRetry(`${responseUrl}/status`, { headers: { Authorization: `Key ${apiKey}` } }, 3);
      if (!st.ok) continue;
      const s = await st.json();
      if (s.status === "COMPLETED") {
        completed = true;
        break;
      }
    } catch {
      // transient poll error — keep waiting, the render is already paid for
    }
  }
  if (!completed) throw new Error(`fal wait timeout after ${maxWaitMs}ms, recover manually: ${responseUrl}`);

  for (let i = 0; i < 8; i++) {
    const res = await fetchWithRetry(responseUrl, { headers: { Authorization: `Key ${apiKey}` } }, 3);
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      const imageUrl = data.images?.[0]?.url || data.image?.url || "";
      if (imageUrl) return imageUrl;
    }
    await sleep(2500);
  }
  throw new Error(`fal result unavailable after retries, recover manually: ${responseUrl}`);
}

async function uploadLocalFileToFal(localPath, apiKey) {
  const bytes = readFileSync(localPath);
  const init = await fetchWithRetry(STORAGE_INITIATE, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: "image/png", file_name: basename(localPath) }),
  });
  if (!init.ok) throw new Error(`fal storage initiate ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const ij = await init.json();
  if (!ij.upload_url || !ij.file_url) throw new Error("fal storage initiate without upload_url/file_url");
  const put = await fetchWithRetry(ij.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: bytes,
  });
  if (!put.ok) throw new Error(`fal storage upload ${put.status}: ${(await put.text()).slice(0, 300)}`);
  return ij.file_url;
}

async function download(url, dest) {
  const res = await fetchWithRetry(url, {}, 3);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function renderSpec(spec, apiKey, outDir) {
  const isAngle = Boolean(spec.hero_image_url);
  const model = isAngle ? ANGLE_MODEL : HERO_MODEL;
  const body = isAngle
    ? { image_urls: [spec.hero_image_url], prompt: spec.prompt, num_images: 1, aspect_ratio: "9:16", output_format: "png" }
    : { prompt: spec.prompt, num_images: 1, aspect_ratio: "9:16", output_format: "png" };
  const imageUrl = await falQueueRun(model, body, apiKey);
  const localPath = join(outDir, `${spec.spec_id}.png`);
  await download(imageUrl, localPath);
  return {
    ok: true,
    spec_id: spec.spec_id,
    persona_id: spec.persona_id || null,
    vibe_id: spec.vibe_id || null,
    angle_id: spec.angle_id || null,
    image_url: imageUrl,
    local_path: localPath,
    hypothesis: spec.hypothesis,
  };
}

function readResultsFile(sourcePath) {
  let raw;
  try {
    raw = readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read --hero-source ${sourcePath}: ${String(error?.message || error)}`);
  }
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw new Error(`--hero-source ${sourcePath} is not valid JSON`);
  }
  if (!Array.isArray(rows)) {
    throw new Error(`--hero-source ${sourcePath} must be results-sanitized.json (an array), not planned-runs.json`);
  }
  return rows;
}

async function resolveHero(apiKey) {
  const heroFile = argValue("--hero-file", "");
  if (heroFile) {
    const url = await uploadLocalFileToFal(heroFile, apiKey);
    return { url, scope: basename(heroFile).replace(/\.[a-z0-9]+$/i, "") };
  }
  const direct = argValue("--hero-url", "");
  if (direct) {
    return { url: direct, scope: createHash("sha1").update(direct).digest("hex").slice(0, 10) };
  }
  const sourcePath = argValue("--hero-source", "");
  const heroId = argValue("--hero-id", "");
  if (!sourcePath || !heroId) {
    throw new Error(
      "angles stage needs one of: --hero-file <local.png> (re-uploads to fal, survives fal.media expiry), --hero-url <https://...>, or --hero-source <hero results-sanitized.json> plus --hero-id <spec_id>",
    );
  }
  const rows = readResultsFile(sourcePath);
  const hit = rows.find((row) => row.ok && row.spec_id === heroId);
  if (!hit?.image_url) throw new Error(`hero ${heroId} not found or has no image_url in ${sourcePath}`);
  return { url: hit.image_url, scope: heroId };
}

async function main() {
  const stage = argValue("--stage", "hero");
  if (stage !== "hero" && stage !== "angles" && stage !== "looks") throw new Error("--stage must be hero, angles or looks");
  const outRoot = argValue("--out-dir", DEFAULT_OUT_DIR);
  const confirmPaid = boolArg("--confirm-paid");

  let plan;
  let outDir;
  if (stage === "hero") {
    const persona = argValue("--persona", "all");
    outDir = join(outRoot, "hero", persona);
    plan = buildFaceHeroPlan(persona, intArg("--count", 4, 1, 4));
  } else if (stage === "looks") {
    // candid looks rendered externally on FAL from the persona hero, later uploaded to HeyGen as group looks
    const persona = argValue("--persona", "");
    if (!persona) throw new Error("looks stage needs --persona manya|vika|olya");
    const needsUpload = Boolean(argValue("--hero-file", ""));
    const hero = needsUpload && !confirmPaid
      ? { url: "https://dry-run.invalid/hero.png", scope: "dry-run" }
      : await resolveHero(needsUpload || confirmPaid ? falKey() : "");
    outDir = join(outRoot, "looks", persona);
    const looks = buildAvatarGroupLooks(persona, intArg("--count", 14, 1, 14));
    plan = {
      ok: true,
      mode: "face-foundry-looks",
      hero_image_url: hero.url,
      planned_specs: looks.map((look) => ({
        spec_id: look.look_id,
        sequence: look.sequence,
        angle_id: look.scene_id,
        framing: look.framing,
        hero_image_url: hero.url,
        prompt: look.prompt,
        hypothesis: `candid look for HeyGen group upload (${look.framing})`,
      })),
      warnings: [],
    };
  } else {
    // --hero-file upload is a paid-account API call; allow it only together with the paid gate
    const needsUpload = Boolean(argValue("--hero-file", ""));
    const hero = needsUpload && !confirmPaid
      ? { url: "https://dry-run.invalid/hero.png", scope: "dry-run" }
      : await resolveHero(needsUpload || confirmPaid ? falKey() : "");
    outDir = join(outRoot, "angles", hero.scope);
    plan = buildFaceAnglePlan(hero.url, intArg("--count", 24, 1, 24));
  }
  if (!plan.ok) throw new Error(plan.warnings.join("; ") || "plan is not ok");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "planned-runs.json"), JSON.stringify(plan, null, 2));

  if (!confirmPaid) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", stage, planned_path: join(outDir, "planned-runs.json") }, null, 2));
    return;
  }

  const apiKey = falKey();
  const prevResultsPath = join(outDir, "results-sanitized.json");
  const prev = existsSync(prevResultsPath) ? JSON.parse(readFileSync(prevResultsPath, "utf8")) : [];
  const prevBySpec = new Map(prev.filter((r) => r.ok).map((r) => [r.spec_id, r]));

  const results = [];
  for (const spec of plan.planned_specs) {
    const cached = prevBySpec.get(spec.spec_id);
    if (cached && existsSync(cached.local_path)) {
      results.push(cached);
      console.log(`CACHED ${spec.spec_id}`);
      continue;
    }
    console.log(`CREATE ${spec.spec_id}`);
    try {
      const result = await renderSpec(spec, apiKey, outDir);
      results.push(result);
      console.log(`DOWNLOADED ${basename(result.local_path)}`);
    } catch (error) {
      results.push({ ok: false, spec_id: spec.spec_id, error: String(error?.message || error).slice(0, 500) });
    }
  }
  const resultPath = join(outDir, "results-sanitized.json");
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, stage, result_path: resultPath, out_dir: outDir, count: results.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack || error));
    process.exit(1);
  });
}
